/**
 * Timezone-aware date parts without a date library, using Intl (which
 * already ships in the runtime) — the same "no extra dependency for
 * something the platform already does" call made elsewhere in this app.
 */
export function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) % 24, // Intl can return "24" for midnight
    minute: Number(get("minute")),
  };
}

/** Converts an explicit wall-clock time in an IANA timezone to UTC. */
export function zonedDateTimeToUtc(dateKey: string, minuteOfDay: number, timeZone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desired;

  // Two passes handle ordinary offsets and daylight-saving transitions without
  // adding a timezone dependency to the worker.
  for (let pass = 0; pass < 3; pass++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(candidate));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const observed = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
    const correction = desired - observed;
    candidate += correction;
    if (correction === 0) break;
  }
  return new Date(candidate);
}

export function addLocalDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Start of "today" (in the given timezone) expressed as a UTC ISO instant. */
export function startOfTodayIso(timeZone: string): string {
  const { dateKey } = localParts(new Date(), timeZone);
  // Interpreting the local midnight as UTC is an approximation (off by the
  // zone's offset), which is fine here: it only needs to be "early enough"
  // to safely bound a same-day count, not exact to the second.
  return `${dateKey}T00:00:00.000Z`;
}
