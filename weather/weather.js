// Weather summary line: morning / afternoon / evening for the viewed day.
// Click the line to set or change the city.

import { getViewDate } from "../calendar/calendar.js";
import { dateKey } from "../calendar/dates.js";
import { fetchForecast, geocodeCity } from "./api.js";
import { getCity, setCity } from "./store.js";
import { localGet, localOnChanged, localSet } from "../shared/storage.js";

const els = {
  line: document.getElementById("weather-line"),
  dateNote: document.getElementById("weather-date-note"),
};

const PERIODS = [
  ["morning", 6, 12],
  ["afternoon", 12, 18],
  ["evening", 18, 24],
];
const RAIN_THRESHOLD = 50; // percent
const FORECAST_TTL_MS = 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 5 * 60 * 1000;
const CACHE_KEY = "forecastCache";

let city = null;
let forecast = null; // { fetchedAt, time[], temperature[], precipProb[] }
let forecastPromise = null; // dedupes concurrent fetches
let readPromise = null; // dedupes concurrent storage reads
let fetchSeq = 0;

function clearLine() {
  els.line.textContent = "";
  els.line.classList.add("hidden");
  hideDateNote();
}

function hideDateNote() {
  els.dateNote.textContent = "";
  els.dateNote.classList.add("hidden");
}

function renderDateNote(day) {
  els.dateNote.textContent = `forecast for ${day.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  })}`;
  els.dateNote.classList.remove("hidden");
}

// WMO weather code -> monochrome glyph (︎ forces text presentation).
// Checked worst-first since periods report their highest code.
function conditionGlyph(code) {
  if (code >= 95) return "⛈︎";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "❄︎";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "☂︎";
  if (code === 45 || code === 48 || code === 3) return "☁︎";
  if (code === 2) return "⛅︎";
  return "☀︎";
}

// One period's numbers for the given day, or null when the forecast
// doesn't cover it (past days, >16 days out).
function summarizeDay(day) {
  const key = dateKey(day);
  const summary = [];
  for (const [label, fromHour, toHour] of PERIODS) {
    const temps = [];
    const probs = [];
    const codes = [];
    for (let i = 0; i < forecast.time.length; i++) {
      if (!forecast.time[i].startsWith(key)) continue;
      const hour = Number(forecast.time[i].slice(11, 13));
      if (hour < fromHour || hour >= toHour) continue;
      temps.push(forecast.temperature[i]);
      probs.push(forecast.precipProb[i]);
      codes.push(forecast.weatherCode[i]);
    }
    if (temps.length === 0) return null;
    summary.push({
      label,
      temp: Math.round(Math.max(...temps)),
      rain: Math.max(...probs),
      // WMO codes grow roughly with severity; show the period's worst hour.
      code: Math.max(...codes),
    });
  }
  return summary;
}

function appendSep() {
  const sep = document.createElement("span");
  sep.className = "sep";
  sep.textContent = "·";
  els.line.appendChild(sep);
}

function renderSummary(summary, day) {
  els.line.textContent = "";
  const cityName = document.createElement("span");
  cityName.className = "wx-city";
  cityName.textContent = city.name;
  els.line.appendChild(cityName);
  summary.forEach((period) => {
    appendSep();
    const seg = document.createElement("span");
    const rainy = period.rain >= RAIN_THRESHOLD;
    seg.className = rainy ? "seg-rain" : "";
    const base = `${period.label} ${conditionGlyph(period.code)} ${period.temp}°`;
    seg.textContent = rainy ? `${base} ${Math.round(period.rain)}%` : base;
    els.line.appendChild(seg);
  });
  els.line.title = `Weather in ${city.name} — click to change city`;
  els.line.classList.remove("hidden");
  renderDateNote(day);
}

function renderSetCity() {
  els.line.textContent = "";
  const btn = document.createElement("button");
  btn.className = "text-btn weather-set-btn";
  btn.textContent = "set weather city";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    renderCityInput();
  });
  els.line.appendChild(btn);
  els.line.classList.remove("hidden");
  hideDateNote();
}

// Fetch failed with nothing usable to fall back on (e.g. rate-limited right
// after a city switch) — say so instead of hiding the line, and offer a
// manual retry alongside the timed one.
function renderUnavailable() {
  els.line.textContent = "";
  const note = document.createElement("span");
  note.textContent = "weather unavailable";
  els.line.appendChild(note);
  appendSep();

  const btn = document.createElement("button");
  btn.className = "text-btn weather-retry-btn";
  btn.textContent = "retry";
  btn.addEventListener("click", async (e) => {
    e.stopPropagation(); // the line's own click handler opens the city input
    btn.disabled = true;
    btn.textContent = "retrying…";
    await update(); // re-renders the line whichever way it ends
  });
  els.line.appendChild(btn);

  els.line.title = "Click to change city";
  els.line.classList.remove("hidden");
  hideDateNote();
}

function renderCityInput() {
  els.line.textContent = "";
  const input = document.createElement("input");
  input.className = "weather-input";
  input.placeholder = "City for weather…";
  input.value = city?.name || "";
  input.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") {
      city ? update() : renderSetCity();
      return;
    }
    if (e.key !== "Enter") return;
    const name = input.value.trim();
    if (!name) return;
    input.disabled = true;
    try {
      const hit = await geocodeCity(name);
      if (!hit) {
        input.disabled = false;
        input.value = "";
        input.placeholder = "City not found — try again";
        input.focus();
        return;
      }
      await setCity(hit);
      city = hit;
      // New coordinates: drop the old forecast and anything in flight.
      forecast = null;
      forecastPromise = null;
      fetchSeq++;
      update();
    } catch {
      input.disabled = false;
      input.placeholder = "Couldn't look that up — try again";
      input.focus();
    }
  });
  els.line.appendChild(input);
  els.line.classList.remove("hidden");
  hideDateNote();
  input.focus();
}

function forecastIsFresh() {
  return forecast && Date.now() - forecast.fetchedAt < FORECAST_TTL_MS;
}

// Storage is an external boundary — never assume a stored record's shape.
// Element types matter, not just array-ness: summarizeDay indexes the four
// arrays in lockstep and calls string/number methods on entries, so a
// poisoned record would otherwise throw on every render for up to the TTL.
// The length bound keeps spread-based Math.max within argument limits (a
// real 16-day hourly forecast has 384 points).
function isValidStored(stored) {
  if (
    !stored ||
    typeof stored.latitude !== "number" ||
    typeof stored.longitude !== "number" ||
    typeof stored.fetchedAt !== "number" ||
    !Array.isArray(stored.time) ||
    stored.time.length > 800 ||
    !stored.time.every((t) => typeof t === "string")
  ) {
    return false;
  }
  return [stored.temperature, stored.precipProb, stored.weatherCode].every(
    (arr) =>
      Array.isArray(arr) &&
      arr.length === stored.time.length &&
      arr.every((n) => typeof n === "number")
  );
}

// A cached forecast is only meaningful for the city it was fetched for.
// (Coords round-trip losslessly through JSON, so === is safe; a false
// mismatch would just cost one extra fetch.)
function matchesCity(stored) {
  return stored.latitude === city.latitude && stored.longitude === city.longitude;
}

function adoptStored(stored) {
  forecast = {
    fetchedAt: stored.fetchedAt,
    time: stored.time,
    temperature: stored.temperature,
    precipProb: stored.precipProb,
    weatherCode: stored.weatherCode,
  };
}

// Adopt only records for the current city that are newer than what we hold
// (our own write echoes back with an equal fetchedAt, filtered by the >).
function shouldAdopt(stored) {
  return (
    isValidStored(stored) &&
    Boolean(city) &&
    matchesCity(stored) &&
    (!forecast || stored.fetchedAt > forecast.fetchedAt)
  );
}

function isEditingCity() {
  return Boolean(els.line.querySelector("input"));
}

// Adopt the last persisted forecast (any tab's) if it beats what we hold.
// Deduped like the fetch, so overlapping update() calls can't race it.
function readStored() {
  if (!readPromise) {
    readPromise = localGet(CACHE_KEY, null)
      .then((stored) => {
        if (shouldAdopt(stored)) adoptStored(stored);
      })
      .catch(() => {})
      .finally(() => {
        readPromise = null;
      });
  }
  return readPromise;
}

async function ensureForecast() {
  if (forecastIsFresh()) return;
  // Check storage before the network, every time: new tabs warm-start from
  // another tab's fetch, and a tab whose retry raced a sibling's adopts the
  // winner's write instead of piling on. Also lets a city switched back
  // within the TTL reuse its cached forecast.
  await readStored();
  if (forecastIsFresh()) return;
  // One 16-day fetch covers every day the user can page to — rapid
  // navigation while it's in flight must not start duplicates.
  if (!forecastPromise) {
    const seq = ++fetchSeq;
    const p = fetchForecast(city.latitude, city.longitude)
      .then((data) => {
        if (seq === fetchSeq) {
          forecast = { fetchedAt: Date.now(), ...data };
          // Best-effort persist; other tabs adopt it via localOnChanged.
          localSet(CACHE_KEY, {
            latitude: city.latitude,
            longitude: city.longitude,
            fetchedAt: forecast.fetchedAt,
            ...data,
          }).catch(() => {});
        }
      })
      .finally(() => {
        if (forecastPromise === p) forecastPromise = null;
      });
    forecastPromise = p;
  }
  return forecastPromise;
}

// Render whatever `forecast` currently holds for the viewed day — quietly
// absent when nothing covers it (past days, >16 days out, no data at all).
function renderFromForecast() {
  if (!forecast) {
    clearLine();
    return;
  }
  const day = getViewDate();
  const summary = summarizeDay(day);
  summary ? renderSummary(summary, day) : clearLine();
}

async function update() {
  if (!city) {
    city = await getCity();
  }
  if (!city) {
    renderSetCity();
    return;
  }
  try {
    await ensureForecast();
  } catch {
    // Fetch failed (network trouble, rate limit). With stale data on hand,
    // fall through and render it — stale weather beats a vanished widget.
    if (!forecast) {
      renderUnavailable();
      return;
    }
  }
  renderFromForecast();
}

// Clicking the rendered line re-opens the city input (ignore clicks on the
// set-city button, which handles itself).
els.line.addEventListener("click", (e) => {
  if (city && e.target.tagName !== "INPUT") {
    renderCityInput();
  }
});

// Cross-tab sync: adopt another tab's fresher fetch for the same city.
// Skip the re-render (not the adoption) while the city input is open.
localOnChanged(CACHE_KEY, (stored) => {
  if (!shouldAdopt(stored)) return;
  adoptStored(stored);
  if (!isEditingCity()) {
    renderFromForecast();
  }
});

// Revalidate once the forecast outlives its TTL in a long-lived tab, and
// retry (bounded) after a failure like a 429 — once any tab succeeds, the
// rest adopt its result via storage and stop. The per-tab jitter keeps tabs
// that went stale in lockstep from retrying in lockstep too. Skips while
// the city input is open so a background render can't clobber typing.
// Known residual: tabs opened in a burst before any fetch has ever
// succeeded each still fetch once.
setInterval(() => {
  if (!city || isEditingCity()) return;
  if (!forecastIsFresh()) update();
}, RETRY_INTERVAL_MS + Math.random() * 60 * 1000);

document.addEventListener("viewdatechange", update);
update();
