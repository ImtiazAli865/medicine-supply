// Retry delays for sending (plan: Interfaces and contracts). Pure: nothing here reads the clock.

const SCHEDULE_MS = [0, 2_000, 5_000, 15_000, 45_000] as const;
const MAX_MS = 120_000;

/** The wait before try number `attempt` (0 is the first try and is immediate; later tries wait longer, at most 2 minutes). */
export function nextDelayMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt <= 0) return 0;
  const index = Math.floor(attempt);
  return index < SCHEDULE_MS.length ? SCHEDULE_MS[index]! : MAX_MS;
}
