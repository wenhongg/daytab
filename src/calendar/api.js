// Google Calendar auth + API access. No DOM code here.

export function clientIdConfigured() {
  const { oauth2 } = chrome.runtime.getManifest();
  return oauth2 && !oauth2.client_id.startsWith("YOUR_CLIENT_ID");
}

export function getToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || "No token"));
      } else {
        resolve(token);
      }
    });
  });
}

function removeCachedToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}

// RFC3339 timestamp with the real local UTC offset (Date.toISOString always
// emits Z, which shifts day boundaries for non-UTC users).
function rfc3339(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

// Revoke the Google grant and drop Chrome's cached token, so the next
// connect shows the full consent screen again.
export async function signOut() {
  let token;
  try {
    token = await getToken(false);
  } catch {
    return; // nothing to sign out of
  }
  try {
    // Server-side revocation is fire-and-forget; the opaque no-cors
    // response doesn't matter and failures still leave us signed out
    // locally. POST body keeps the token out of URL logs.
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // best-effort
  }
  await removeCachedToken(token);
}

export class ApiError extends Error {
  constructor(status) {
    super(`Calendar API error (${status})`);
    this.status = status;
  }
}

async function authorizedGet(url) {
  let token = await getToken(false);
  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    await removeCachedToken(token);
    token = await getToken(false);
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }
  if (!res.ok) {
    throw new ApiError(res.status);
  }
  return res.json();
}

// The calendars this account can see (id, name, color, primary/selected flags).
export async function fetchCalendarList() {
  const params = new URLSearchParams({
    // Silently caps accounts with >250 calendars — fine for a personal dashboard.
    maxResults: "250",
    fields: "items(id,summary,backgroundColor,primary,selected)",
  });
  const data = await authorizedGet(
    `https://www.googleapis.com/calendar/v3/users/me/calendarList?${params}`
  );
  return data.items || [];
}

// Only what the agenda renders — full event resources (attendees, extended
// properties, …) would bloat the persisted cache for nothing. Callers that
// need even less (e.g. the month view's counts) pass a slimmer mask.
const DEFAULT_EVENT_FIELDS = "items(id,summary,location,start,end,description)";

// Events between two local-time Dates (start inclusive, end exclusive).
export async function fetchEventsForRange(
  calendarId,
  start,
  end,
  eventFields = DEFAULT_EVENT_FIELDS
) {
  const params = new URLSearchParams({
    timeMin: rfc3339(start),
    timeMax: rfc3339(end),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
    fields: eventFields,
  });
  const data = await authorizedGet(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`
  );
  return data.items || [];
}
