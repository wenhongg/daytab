// Calendar picker: choose which calendars feed the agenda and dots.
// Open with C or the "calendars" button under the agenda.

import {
  getCalendars,
  getOverrides,
  isEnabled,
  setOverride,
  onOverridesChanged,
  resetCache,
} from "./calendars.js";
import { signOut } from "./api.js";
import { isOpen as monthIsOpen } from "./month.js";

const els = {
  overlay: document.getElementById("cal-overlay"),
  list: document.getElementById("cal-list"),
  trigger: document.getElementById("cal-btn"),
  signout: document.getElementById("cal-signout"),
};

export function isOpen() {
  return !els.overlay.classList.contains("hidden");
}

async function render() {
  els.list.textContent = "";
  let calendars;
  let overrides;
  try {
    [calendars, overrides] = await Promise.all([getCalendars(), getOverrides()]);
  } catch {
    const p = document.createElement("p");
    p.className = "cal-empty";
    p.textContent = "Connect Google Calendar first.";
    els.list.appendChild(p);
    return;
  }

  const sorted = [...calendars].sort(
    (a, b) =>
      (b.primary ? 1 : 0) - (a.primary ? 1 : 0) ||
      (a.summary || "").localeCompare(b.summary || "")
  );

  for (const cal of sorted) {
    const row = document.createElement("label");
    row.className = "cal-row";

    const swatch = document.createElement("span");
    swatch.className = "cal-swatch";
    if (cal.backgroundColor) {
      swatch.style.backgroundColor = cal.backgroundColor;
    }
    row.appendChild(swatch);

    const name = document.createElement("span");
    name.className = "cal-name";
    name.textContent = cal.summary || cal.id;
    row.appendChild(name);

    if (cal.primary) {
      const sub = document.createElement("span");
      sub.className = "cal-sub";
      sub.textContent = "primary";
      row.appendChild(sub);
    }

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = isEnabled(cal, overrides);
    box.addEventListener("change", () => setOverride(cal.id, box.checked));
    row.appendChild(box);

    els.list.appendChild(row);
  }
}

function open() {
  render();
  els.overlay.classList.remove("hidden");
}

function close() {
  els.overlay.classList.add("hidden");
}

els.trigger.addEventListener("click", open);

els.signout.addEventListener("click", async () => {
  els.signout.disabled = true;
  await signOut();
  // Deliberately keep calendarOverrides (and all other prefs): the common
  // case is reconnecting the same account, and stale overrides for a
  // different account simply never match its calendar ids.
  resetCache();
  els.signout.disabled = false;
  close();
  document.dispatchEvent(new Event("signedout"));
});

els.overlay.addEventListener("click", (e) => {
  if (e.target === els.overlay) close();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isOpen()) {
    close();
    return;
  }
  const typing = e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA";
  if (
    (e.key === "c" || e.key === "C") &&
    !isOpen() &&
    !monthIsOpen() &&
    !typing &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey
  ) {
    open();
  }
});

// Single update path (same convention as todos): the storage change — from
// this tab or any other — is what notifies the views.
onOverridesChanged(() => document.dispatchEvent(new Event("calendarschange")));
