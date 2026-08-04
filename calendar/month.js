// Month overlay: event-density grid; open with M or by clicking the date numeral.

import { fetchMergedEvents } from "./calendars.js";
import { addDays, dateKey, eventCountsByDay, isToday, weekStartOf } from "./dates.js";
import { getViewDate, goToDate } from "./calendar.js";
import { isOpen as pickerIsOpen } from "./picker.js";

const els = {
  overlay: document.getElementById("month-overlay"),
  title: document.getElementById("mc-title"),
  grid: document.getElementById("mc-grid"),
  prev: document.getElementById("mc-prev"),
  next: document.getElementById("mc-next"),
  today: document.getElementById("mc-today"),
  dayNumber: document.getElementById("day-number"),
};

let monthDate = null; // first day of the displayed month
let countsMonthMs = null;
let counts = new Map();
let loadSeq = 0;

function firstOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function isOpen() {
  return !els.overlay.classList.contains("hidden");
}

function open() {
  monthDate = firstOfMonth(getViewDate());
  render();
  els.overlay.classList.remove("hidden");
}

function close() {
  els.overlay.classList.add("hidden");
}

function setMonth(date) {
  monthDate = firstOfMonth(date);
  render();
}

function render() {
  els.title.textContent = monthDate.toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });
  els.grid.textContent = "";

  const gridStart = weekStartOf(monthDate);
  for (let i = 0; i < 7; i++) {
    const dow = document.createElement("p");
    dow.className = "mc-dow";
    dow.textContent = addDays(gridStart, i).toLocaleDateString([], {
      weekday: "short",
    });
    els.grid.appendChild(dow);
  }

  const lastOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  // Whole days between the grid's Monday and the 1st (round absorbs DST skew).
  const leading = Math.round((monthDate - gridStart) / 86400000);
  const totalCells = Math.ceil((leading + lastOfMonth.getDate()) / 7) * 7;
  const viewMs = getViewDate().getTime();
  const hasCounts = countsMonthMs === monthDate.getTime();

  for (let i = 0; i < totalCells; i++) {
    const day = addDays(gridStart, i);
    const cell = document.createElement("button");
    cell.className = "mc-day";
    cell.classList.toggle("dim", day.getMonth() !== monthDate.getMonth());
    cell.classList.toggle("selected", day.getTime() === viewMs);
    cell.classList.toggle("today", isToday(day));

    const num = document.createElement("p");
    num.className = "mc-num";
    num.textContent = day.getDate();
    cell.appendChild(num);

    const dots = document.createElement("span");
    dots.className = "mc-dots";
    const count = hasCounts ? counts.get(dateKey(day)) || 0 : 0;
    for (let d = 0; d < Math.min(count, 3); d++) {
      dots.appendChild(document.createElement("i"));
    }
    cell.appendChild(dots);

    cell.addEventListener("click", () => {
      goToDate(day);
      close();
    });
    els.grid.appendChild(cell);
  }

  loadCounts();
}

async function loadCounts() {
  if (countsMonthMs === monthDate.getTime()) return;
  const seq = ++loadSeq;
  const rangeStart = monthDate;
  try {
    const events = await fetchMergedEvents(
      rangeStart,
      new Date(rangeStart.getFullYear(), rangeStart.getMonth() + 1, 1),
      // Density dots only need start days — skip titles/descriptions, which
      // at month scale is a lot of payload for nothing.
      "items(start)"
    );
    if (seq !== loadSeq) return;
    // The user may have paged to a different month and back while this
    // fetch was in flight — only keep the result if it's still on screen.
    if (rangeStart.getTime() !== monthDate.getTime()) return;
    counts = eventCountsByDay(events);
    countsMonthMs = rangeStart.getTime();
    if (isOpen()) render();
  } catch {
    // The agenda owns auth/network error UX; the grid just stays dotless.
  }
}

els.dayNumber.addEventListener("click", open);
els.prev.addEventListener("click", () =>
  setMonth(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))
);
els.next.addEventListener("click", () =>
  setMonth(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))
);
els.today.addEventListener("click", () => setMonth(new Date()));

// Clicking the scrim (not the card) dismisses.
els.overlay.addEventListener("click", (e) => {
  if (e.target === els.overlay) close();
});

// Picker toggles invalidate the month's counts; sign-out drops them too.
for (const eventName of ["calendarschange", "signedout"]) {
  document.addEventListener(eventName, () => {
    countsMonthMs = null;
    counts = new Map();
    if (isOpen()) render();
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isOpen()) {
    close();
    return;
  }
  const typing = e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA";
  if (
    (e.key === "m" || e.key === "M") &&
    !isOpen() &&
    !pickerIsOpen() &&
    !typing &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey
  ) {
    open();
  }
});
