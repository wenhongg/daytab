// Local-time date math shared by the day view, week strip, and month overlay.

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

// Monday on or before the given date.
export function weekStartOf(date) {
  const day = startOfDay(date);
  return addDays(day, -((day.getDay() + 6) % 7));
}

export function isToday(date) {
  return dateKey(date) === dateKey(new Date());
}

// Local "YYYY-MM-DD" — matches the format of all-day events' start.date.
export function dateKey(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Events from `events` that overlap the given day (a local midnight Date).
export function eventsOnDay(events, day) {
  const key = dateKey(day);
  const dayStart = day;
  const dayEnd = addDays(day, 1);
  return events.filter((event) => {
    if (event.start?.date) {
      // All-day events: end.date is exclusive.
      return event.end?.date
        ? event.start.date <= key && key < event.end.date
        : event.start.date === key;
    }
    if (event.start?.dateTime) {
      const start = new Date(event.start.dateTime);
      const end = event.end?.dateTime ? new Date(event.end.dateTime) : start;
      return start < dayEnd && end > dayStart;
    }
    return false;
  });
}

// Map of dateKey -> number of events starting that day.
export function eventCountsByDay(events) {
  const counts = new Map();
  for (const event of events) {
    const key =
      event.start?.date ||
      (event.start?.dateTime && dateKey(new Date(event.start.dateTime)));
    if (key) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}
