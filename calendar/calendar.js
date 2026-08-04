// Day view: date header, prev/next navigation, week strip, agenda rendering.
// Events are fetched one week at a time and cached; day navigation within
// the cached week renders instantly without refetching. The current week is
// also persisted to chrome.storage.local so new tabs render instantly and
// only hit the network once the cache goes stale (or on manual refresh).

import { ApiError, clientIdConfigured, getToken } from "./api.js";
import { fetchMergedEvents } from "./calendars.js";
import { sanitizeDescription } from "./sanitize.js";
import { localGet, localOnChanged, localSet } from "../shared/storage.js";
import {
  addDays,
  dateKey,
  eventCountsByDay,
  eventsOnDay,
  isToday,
  startOfDay,
  weekStartOf,
} from "./dates.js";

const els = {
  weekday: document.getElementById("weekday"),
  dayNumber: document.getElementById("day-number"),
  monthYear: document.getElementById("month-year"),
  tzLabel: document.getElementById("tz-label"),
  prevDay: document.getElementById("prev-day"),
  nextDay: document.getElementById("next-day"),
  todayBtn: document.getElementById("today-btn"),
  weekStrip: document.getElementById("week-strip"),
  setupNotice: document.getElementById("setup-notice"),
  connectPanel: document.getElementById("connect-panel"),
  agendaStatus: document.getElementById("agenda-status"),
  eventList: document.getElementById("event-list"),
  fetchStamp: document.getElementById("fetch-stamp"),
  refreshBtn: document.getElementById("refresh-btn"),
  connectBtn: document.getElementById("connect-btn"),
};

const CACHE_KEY = "weekEventsCache";
const EVENTS_TTL_MS = 5 * 60 * 1000;

const emptyWeekCache = () => ({
  startMs: null,
  events: [],
  counts: new Map(),
  fetchedAt: null,
});

let viewDate = startOfDay(new Date());
let weekSeq = 0; // guards against stale responses on rapid navigation
let weekCache = emptyWeekCache();
// Which events' descriptions are open, by event id — module scope so the
// 60s re-render (and cross-tab sync) doesn't snap open panels shut.
const expandedEventIds = new Set();

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function renderHeader() {
  els.weekday.textContent = viewDate.toLocaleDateString([], { weekday: "long" });
  els.dayNumber.textContent = viewDate.getDate();
  els.monthYear.textContent = viewDate.toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });
  els.monthYear.href =
    "https://calendar.google.com/calendar/u/0/r/day/" +
    `${viewDate.getFullYear()}/${viewDate.getMonth() + 1}/${viewDate.getDate()}`;
  els.todayBtn.classList.toggle("hidden", isToday(viewDate));

  // System timezone; the name is per viewed date so DST reads correctly.
  const zoneName = new Intl.DateTimeFormat([], { timeZoneName: "long" })
    .formatToParts(viewDate)
    .find((part) => part.type === "timeZoneName")?.value;
  els.tzLabel.textContent =
    zoneName ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function goToDate(date) {
  viewDate = startOfDay(date);
  renderHeader();
  renderWeekStrip();
  loadDay();
  // Lets other modules (e.g. weather) follow day navigation without the
  // calendar needing to know about them; listeners read getViewDate().
  document.dispatchEvent(new Event("viewdatechange"));
}

export function getViewDate() {
  return viewDate;
}

function hasCachedWeek(weekStart) {
  return weekCache.startMs === weekStart.getTime();
}

function renderWeekStrip() {
  const weekStart = weekStartOf(viewDate);
  const cached = hasCachedWeek(weekStart);
  els.weekStrip.textContent = "";

  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    const cell = document.createElement("button");
    cell.className = "ws-cell";
    cell.classList.toggle("selected", day.getTime() === viewDate.getTime());
    cell.classList.toggle("today", isToday(day));

    const dow = document.createElement("p");
    dow.className = "ws-dow";
    dow.textContent = day.toLocaleDateString([], { weekday: "short" });
    cell.appendChild(dow);

    const num = document.createElement("p");
    num.className = "ws-num";
    num.textContent = day.getDate();
    cell.appendChild(num);

    const dots = document.createElement("span");
    dots.className = "ws-dots";
    const count = cached ? weekCache.counts.get(dateKey(day)) || 0 : 0;
    for (let d = 0; d < Math.min(count, 3); d++) {
      dots.appendChild(document.createElement("i"));
    }
    cell.appendChild(dots);

    cell.addEventListener("click", () => goToDate(day));
    els.weekStrip.appendChild(cell);
  }
}

function setAgendaStatus(message) {
  els.agendaStatus.textContent = message || "";
  els.agendaStatus.classList.toggle("hidden", !message);
}

// Disclosure widget for an event with a description: appends the toggle
// button (title + chevron) to `li` and returns the details panel for the
// caller to place after the location line. Sanitizing is deferred until the
// panel first opens, so collapsed rows cost nothing on the 60s re-render.
function buildDisclosure(li, event, title, description, index) {
  const expanded = expandedEventIds.has(event.id);
  li.classList.toggle("expanded", expanded);

  const toggle = document.createElement("button");
  toggle.className = "event-toggle";
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.setAttribute("aria-controls", `event-details-${index}`);
  const titleEl = document.createElement("span");
  titleEl.className = "event-title";
  titleEl.textContent = title;
  toggle.appendChild(titleEl);
  li.appendChild(toggle);

  const details = document.createElement("div");
  details.className = "event-details";
  details.id = `event-details-${index}`;
  details.classList.toggle("hidden", !expanded);
  if (expanded) {
    details.appendChild(sanitizeDescription(description));
  }

  toggle.addEventListener("click", () => {
    const open = !details.classList.toggle("hidden");
    if (open && !details.hasChildNodes()) {
      details.appendChild(sanitizeDescription(description));
    }
    li.classList.toggle("expanded", open);
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      expandedEventIds.add(event.id);
    } else {
      expandedEventIds.delete(event.id);
    }
  });

  return details;
}

function renderEvents(events) {
  els.eventList.textContent = "";
  if (events.length === 0) {
    setAgendaStatus("Nothing scheduled.");
    return;
  }
  setAgendaStatus("");

  const allDay = events.filter((e) => e.start?.date);
  const timed = events.filter((e) => e.start?.dateTime);
  const now = new Date();

  for (const [index, event] of [...allDay, ...timed].entries()) {
    const li = document.createElement("li");
    li.className = "event";

    const dot = document.createElement("span");
    dot.className = "event-dot";
    if (event.calendarColor) {
      dot.style.backgroundColor = event.calendarColor;
    }
    li.appendChild(dot);

    const addLine = (cls, text) => {
      const p = document.createElement("p");
      p.className = cls;
      p.textContent = text;
      li.appendChild(p);
    };

    if (event.start.dateTime) {
      const start = new Date(event.start.dateTime);
      const end = event.end?.dateTime ? new Date(event.end.dateTime) : start;
      addLine("event-time", `${formatTime(start)} – ${formatTime(end)}`);

      const minutesAway = Math.ceil((start - now) / 60000);
      if (minutesAway > 0 && minutesAway <= 60) {
        li.classList.add("has-soon");
        const soon = document.createElement("span");
        soon.className = "event-soon";
        soon.textContent = `in ${minutesAway} min`;
        li.appendChild(soon);
      }
    } else {
      addLine("event-time", "All day");
    }
    const title = event.summary || "(No title)";
    // Storage is an external boundary (see isValidStored) — only trust a
    // string description. Events without one stay plain, untoggleable rows.
    const description =
      typeof event.description === "string" && event.description.trim()
        ? event.description
        : null;

    let details = null;
    if (description) {
      details = buildDisclosure(li, event, title, description, index);
    } else {
      addLine("event-title", title);
    }
    if (event.location) {
      addLine("event-location", event.location);
    }
    if (details) {
      li.appendChild(details);
    }

    els.eventList.appendChild(li);
  }
}

function showAgendaFromCache() {
  renderEvents(eventsOnDay(weekCache.events, viewDate));
  els.fetchStamp.textContent = `updated ${formatTime(weekCache.fetchedAt)}`;
  els.fetchStamp.classList.remove("hidden");
  els.refreshBtn.classList.remove("hidden");
  els.connectPanel.classList.add("hidden");
}

function cacheIsStale() {
  return Date.now() - weekCache.fetchedAt.getTime() >= EVENTS_TTL_MS;
}

// Storage is an external boundary — never assume a stored record's shape
// (a partial write or future format change must not break rendering).
function isValidStored(stored) {
  return (
    Boolean(stored) &&
    typeof stored.startMs === "number" &&
    typeof stored.fetchedAt === "number" &&
    Array.isArray(stored.events) &&
    stored.events.every((event) => event && typeof event === "object")
  );
}

// Rebuild the in-memory cache from its stored form (counts and Dates don't
// survive JSON serialization).
function hydrateCache(stored) {
  weekCache = {
    startMs: stored.startMs,
    events: stored.events,
    counts: eventCountsByDay(stored.events),
    fetchedAt: new Date(stored.fetchedAt),
  };
  // Forget expanded state for events that no longer exist (cancelled, or a
  // different week) so the set can't grow unboundedly in a long-lived tab.
  const ids = new Set(stored.events.map((event) => event.id));
  for (const id of [...expandedEventIds]) {
    if (!ids.has(id)) expandedEventIds.delete(id);
  }
}

// `background` keeps whatever is on screen (cached events stay up, no
// loading flicker) and stays quiet on failure.
async function fetchWeek(background) {
  const weekStart = weekStartOf(viewDate);
  const seq = ++weekSeq;
  if (!background) {
    els.eventList.textContent = "";
    els.fetchStamp.classList.add("hidden");
    setAgendaStatus("Loading…");
  }
  try {
    const events = await fetchMergedEvents(weekStart, addDays(weekStart, 7));
    if (seq !== weekSeq) return; // a newer request superseded this one
    // This tab went to the disconnected state (sign-out here or in another
    // tab) while the fetch was in flight — don't resurrect cleared data.
    if (background && !els.connectPanel.classList.contains("hidden")) return;
    // The user may have navigated to a different week and back while this
    // fetch was in flight — only keep the result if it's still on screen.
    if (weekStart.getTime() !== weekStartOf(viewDate).getTime()) return;
    const stored = { startMs: weekStart.getTime(), events, fetchedAt: Date.now() };
    hydrateCache(stored);
    renderWeekStrip();
    showAgendaFromCache();
    // Best-effort persist; other open tabs pick it up via localOnChanged.
    localSet(CACHE_KEY, stored).catch(() => {});
    return true;
  } catch (err) {
    if (seq !== weekSeq) return;
    if (err instanceof ApiError || err instanceof TypeError) {
      // Server or network trouble — transient, keep showing what we had.
      if (!background) {
        setAgendaStatus(
          err instanceof ApiError
            ? `Couldn't load events. ${err.message}`
            : "Couldn't load events. Check your connection."
        );
      }
    } else {
      // Not signed in — including consent revoked from Google's side, which
      // background revalidation must catch too: stop showing and holding
      // events we're no longer authorized to have. Clearing storage carries
      // this to every other open tab via localOnChanged.
      disconnect();
    }
    return false;
  }
}

// Renders from the in-memory cache when it covers the viewed week, quietly
// revalidating once it outlives the TTL. False on a cache miss.
function refreshIfCached() {
  if (!hasCachedWeek(weekStartOf(viewDate))) return false;
  showAgendaFromCache(); // instant — no request, no loading flicker
  if (cacheIsStale()) {
    fetchWeek(true); // revalidate behind the cached render
  }
  return true;
}

function loadDay() {
  if (!refreshIfCached()) {
    fetchWeek(false);
  }
}

els.prevDay.addEventListener("click", () => goToDate(addDays(viewDate, -1)));
els.nextDay.addEventListener("click", () => goToDate(addDays(viewDate, 1)));
els.todayBtn.addEventListener("click", () => goToDate(new Date()));

// Manual refresh ignores the TTL. With events on screen it fetches quietly
// behind them, using the stamp for feedback — a silent failure would make
// the button look dead.
els.refreshBtn.addEventListener("click", async () => {
  if (!hasCachedWeek(weekStartOf(viewDate))) {
    fetchWeek(false);
    return;
  }
  els.fetchStamp.textContent = "refreshing…";
  const ok = await fetchWeek(true);
  // Success and navigation both re-render the stamp on their own; the
  // hasCachedWeek check skips states where the agenda was torn down.
  if (ok === false && hasCachedWeek(weekStartOf(viewDate))) {
    els.fetchStamp.textContent = "couldn't refresh";
  }
});

els.connectBtn.addEventListener("click", async () => {
  try {
    await getToken(true);
    els.connectPanel.classList.add("hidden");
    loadDay();
  } catch (err) {
    setAgendaStatus("Sign-in was cancelled or failed. Try again.");
  }
});

// Drop everything on screen and show the connect state.
function showDisconnected() {
  weekCache = emptyWeekCache();
  renderWeekStrip();
  els.eventList.textContent = "";
  els.fetchStamp.classList.add("hidden");
  els.refreshBtn.classList.add("hidden"); // nothing to refresh while disconnected
  setAgendaStatus("");
  els.connectPanel.classList.remove("hidden");
}

// Disconnected for real (signed out or consent revoked) — also stop keeping
// events on disk, which carries the state to other tabs via localOnChanged.
function disconnect() {
  localSet(CACHE_KEY, null).catch(() => {});
  showDisconnected();
}

// Sign-out from the picker: show the connect state directly (revocation may
// still be propagating, so don't refetch).
document.addEventListener("signedout", () => {
  weekSeq++; // discard any fetch in flight — it would resurrect the cache
  disconnect();
});

// Picker toggles (this tab or another) change what should be shown. The
// persisted cache goes too — it holds the old calendar selection and would
// otherwise look fresh to a newly opened tab.
document.addEventListener("calendarschange", () => {
  weekCache = emptyWeekCache();
  localSet(CACHE_KEY, null).catch(() => {});
  renderWeekStrip();
  loadDay();
});

// Cross-tab sync: adopt another tab's refresh when it's the week on screen,
// and treat a cleared cache as that tab's sign-out (or calendar change — in
// that case the calendarschange broadcast refetches right after, which
// hides the connect panel again).
localOnChanged(CACHE_KEY, (stored) => {
  if (!stored) {
    showDisconnected();
    return;
  }
  if (!isValidStored(stored)) return;
  if (stored.startMs !== weekStartOf(viewDate).getTime()) return;
  if (stored.fetchedAt === weekCache.fetchedAt?.getTime()) return; // own write echoing back
  hydrateCache(stored);
  renderWeekStrip();
  showAgendaFromCache();
});

// Keep the "in N min" badges honest if a tab stays open, and revalidate
// once the cache outlives its TTL — this is the "fetch at intervals" path.
setInterval(refreshIfCached, 60000);

async function init() {
  renderHeader();
  renderWeekStrip();
  if (!clientIdConfigured()) {
    els.setupNotice.classList.remove("hidden");
    els.refreshBtn.classList.add("hidden"); // nothing to refresh yet
    return;
  }
  // Warm the in-memory cache from the last persisted fetch (any tab's), so
  // a new tab renders instantly; loadDay revalidates if it's stale.
  const stored = await localGet(CACHE_KEY, null);
  if (isValidStored(stored) && stored.startMs === weekStartOf(viewDate).getTime()) {
    hydrateCache(stored);
    renderWeekStrip();
  }
  loadDay();
}

init();
