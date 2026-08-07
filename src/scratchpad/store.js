// Scratchpad persistence in chrome.storage.sync. No DOM code here.

import { syncGet, syncSet, syncOnChanged } from "../shared/storage.js";

const KEY = "scratchpad";

export const getScratchpad = () => syncGet(KEY, "");

export const setScratchpad = (text) => syncSet(KEY, text);

export const onScratchpadChanged = (callback) =>
  syncOnChanged(KEY, (text) => callback(text || ""));
