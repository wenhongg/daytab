// Which calendars feed the views: calendar-list caching, user overrides,
// and the merged multi-calendar event fetch. No DOM code here.

import { fetchCalendarList, fetchEventsForRange } from "./api.js";
import { syncGet, syncSet, syncOnChanged } from "../shared/storage.js";

const KEY = "calendarOverrides";
const LIST_TTL_MS = 60 * 60 * 1000;

let listCache = null; // { fetchedAt, calendars }
let listPromise = null; // dedupes concurrent list fetches
let overrides = null;

export function getCalendars() {
  if (listCache && Date.now() - listCache.fetchedAt < LIST_TTL_MS) {
    return Promise.resolve(listCache.calendars);
  }
  if (!listPromise) {
    listPromise = fetchCalendarList()
      .then((calendars) => {
        listCache = { fetchedAt: Date.now(), calendars };
        return calendars;
      })
      .finally(() => {
        listPromise = null;
      });
  }
  return listPromise;
}

export async function getOverrides() {
  if (overrides === null) {
    overrides = (await syncGet(KEY, {})) || {};
  }
  return overrides;
}

export async function setOverride(calendarId, enabled) {
  const current = await getOverrides();
  overrides = { ...current, [calendarId]: enabled };
  await syncSet(KEY, overrides);
}

// Primary always defaults on (it's the calendar that always worked);
// others follow Google Calendar's own sidebar `selected` flag, which also
// means calendars added later inherit their Google-side default. User
// overrides win over both.
export function isEnabled(cal, ov) {
  if (cal.id in ov) return Boolean(ov[cal.id]);
  return cal.primary ? true : Boolean(cal.selected);
}

async function resolveEnabled() {
  const [calendars, ov] = await Promise.all([getCalendars(), getOverrides()]);
  return calendars.filter((cal) => isEnabled(cal, ov));
}

// Events across all enabled calendars for the range, each tagged with its
// calendar's color. One failing calendar degrades quietly; only a total
// failure (e.g. signed out) throws so callers can show the connect UX.
export async function fetchMergedEvents(start, end, eventFields) {
  const enabled = await resolveEnabled();
  const results = await Promise.allSettled(
    enabled.map((cal) =>
      fetchEventsForRange(cal.id, start, end, eventFields).then((events) =>
        events.map((event) => ({ ...event, calendarColor: cal.backgroundColor }))
      )
    )
  );
  if (enabled.length > 0 && results.every((r) => r.status === "rejected")) {
    throw results[0].reason;
  }
  const events = results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value);

  // Sort each kind on its own terms: all-day starts are plain local
  // "YYYY-MM-DD" strings (never feed them to `new Date` — that parses as
  // UTC and shifts day boundaries); timed starts carry real offsets.
  const allDay = events
    .filter((e) => e.start?.date)
    .sort((a, b) => (a.start.date < b.start.date ? -1 : a.start.date > b.start.date ? 1 : 0));
  const timed = events
    .filter((e) => e.start?.dateTime)
    .sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime));
  return [...allDay, ...timed];
}

// Forget the fetched calendar list (kept prefs intact) — used on sign-out.
export function resetCache() {
  listCache = null;
  listPromise = null;
}

export function onOverridesChanged(callback) {
  syncOnChanged(KEY, (value) => {
    overrides = value || {};
    callback();
  });
}
