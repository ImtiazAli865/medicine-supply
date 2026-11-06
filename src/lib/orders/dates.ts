// Pakistan Standard Time is UTC+05:00 all year (no daylight saving), so a fixed offset is exact.
// The history list filters by Pakistan calendar days; the database does the same conversion with
// the Asia/Karachi zone. These helpers are for the screens and for tests.

const OFFSET_MS = 5 * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Start of the given Pakistan day as a UTC time, or throws when the text is not a real date. */
function dayStartUtc(date: string, addDays = 0): number {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new Error(`Not a date (expected YYYY-MM-DD): ${date}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error(`Not a real date: ${date}`);
  }
  return Date.UTC(year, month - 1, day + addDays) - OFFSET_MS;
}

/**
 * The UTC instants that bound a range of Pakistan days: `from` is 00:00 of the first day,
 * `toExclusive` is 00:00 of the day after the last day. Either end may be left open.
 */
export function pakistanDayRange(
  from: string | undefined,
  to: string | undefined,
): { from: string | undefined; toExclusive: string | undefined } {
  const start = from === undefined ? undefined : dayStartUtc(from);
  const end = to === undefined ? undefined : dayStartUtc(to, 1);
  if (start !== undefined && end !== undefined && start >= end) throw new Error("The start date is after the end date.");
  return {
    from: start === undefined ? undefined : new Date(start).toISOString(),
    toExclusive: end === undefined ? undefined : new Date(end).toISOString(),
  };
}

/** Today's calendar day in Pakistan as YYYY-MM-DD. */
export function todayInPakistan(now: Date = new Date()): string {
  return new Date(now.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

function shifted(iso: string): Date | null {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : new Date(time + OFFSET_MS);
}

const two = (n: number) => String(n).padStart(2, "0");

/** "14:05": the time of day in Pakistan time. Empty text for an invalid value. */
export function formatPakistanTime(iso: string): string {
  const d = shifted(iso);
  return d ? `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}` : "";
}

/** "6 Nov 2026, 14:05" in Pakistan time. Empty text for an invalid value. */
export function formatPakistanDateTime(iso: string): string {
  const d = shifted(iso);
  if (!d) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}
