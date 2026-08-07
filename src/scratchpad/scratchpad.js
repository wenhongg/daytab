// Scratchpad: free-form notes with debounced autosave.

import { getScratchpad, setScratchpad, onScratchpadChanged } from "./store.js";

const els = {
  input: document.getElementById("scratchpad-input"),
  status: document.getElementById("scratchpad-status"),
};

// Debounce keeps writes well under chrome.storage.sync's per-minute limits
// (~120/min — 1s spacing leaves 2x headroom).
const SAVE_DELAY_MS = 1000;
let saveTimer = null;

function setStatus(message, isError) {
  els.status.textContent = message;
  els.status.classList.toggle("error", Boolean(isError));
}

async function save() {
  saveTimer = null;
  try {
    await setScratchpad(els.input.value);
    setStatus("saved automatically", false);
  } catch (err) {
    setStatus("Couldn't save — note may be too long.", true);
  }
}

function flushPendingSave() {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    save();
  }
}

els.input.addEventListener("input", () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DELAY_MS);
});

// Don't lose the debounce window when the tab closes or loses focus.
els.input.addEventListener("blur", flushPendingSave);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPendingSave();
});

// Follow edits from other tabs, but never clobber active typing.
let gotUpdate = false;
onScratchpadChanged((text) => {
  gotUpdate = true;
  if (document.activeElement !== els.input && els.input.value !== text) {
    els.input.value = text;
  }
});

// The initial read is stale if the user started typing or a change event
// arrived while it was in flight — apply it only when neither happened.
getScratchpad().then((text) => {
  if (!gotUpdate && document.activeElement !== els.input) {
    els.input.value = text;
  }
});
