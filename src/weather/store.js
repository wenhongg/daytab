// Weather city persistence in chrome.storage.sync. No DOM code here.
// (No onChanged wrapper: the line re-reads the city on each page load, and
// live cross-tab sync isn't worth refetching forecasts for.)

import { syncGet, syncSet } from "../shared/storage.js";

const KEY = "weatherCity";

export const getCity = () => syncGet(KEY, null);

export const setCity = (city) => syncSet(KEY, city);
