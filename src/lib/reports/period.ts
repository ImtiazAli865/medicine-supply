import { isRealDay } from "@/lib/validation/market";
import { todayInPakistan } from "@/lib/orders/dates";
import type { ReportGroup } from "./types";

// Periods of the Module 010 reports, always in Pakistan calendar days (UTC+05:00, no daylight saving). The same rules
// are enforced again by the database (report_check_period), so a screen cannot ask for what the server refuses.

export const MAX_PERIOD_DAYS = 731;

export type PeriodPreset = "today" | "this_week" | "this_month" | "last_month";

export interface DayRange {
  from: string;
  to: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parse(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function pakistanToday(now: Date = new Date()): string {
  return todayInPakistan(now);
}

export function addDays(day: string, days: number): string {
  const d = parse(day);
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
}

/** Whole days from `from` to `to`, counting both ends (2026-11-01 to 2026-11-01 is 1). */
export function daysInPeriod(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000) + 1;
}

/** The Monday of the week that holds the day. */
export function weekStart(day: string): string {
  const d = parse(day);
  const back = (d.getUTCDay() + 6) % 7;
  return addDays(day, -back);
}

export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function monthEnd(day: string): string {
  const d = parse(monthStart(day));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return format(d);
}

/** The range of a preset. "This week" and "this month" run up to today, because nothing can be sold later. */
export function presetRange(preset: PeriodPreset, now: Date = new Date()): DayRange {
  const today = pakistanToday(now);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "this_week":
      return { from: weekStart(today), to: today };
    case "this_month":
      return { from: monthStart(today), to: today };
    case "last_month": {
      const lastDayOfPrevious = addDays(monthStart(today), -1);
      return { from: monthStart(lastDayOfPrevious), to: lastDayOfPrevious };
    }
  }
}

/** The period shown when the address has none: this month so far. */
export function defaultPeriod(now: Date = new Date()): DayRange {
  return presetRange("this_month", now);
}

/** Which preset the range equals, or null for a custom range. */
export function matchPreset(range: DayRange, now: Date = new Date()): PeriodPreset | null {
  for (const preset of ["today", "this_week", "this_month", "last_month"] as const) {
    const r = presetRange(preset, now);
    if (r.from === range.from && r.to === range.to) return preset;
  }
  return null;
}

export type PeriodCheck = { ok: true } | { ok: false; message: string };

/** The same rules as the database function report_check_period, with the messages the owner reads. */
export function validatePeriod(range: { from?: string | null; to?: string | null }, now: Date = new Date()): PeriodCheck {
  const { from, to } = range;
  if (!from || !to) return { ok: false, message: "Choose a start date and an end date." };
  if (!isRealDay(from) || !isRealDay(to)) return { ok: false, message: "Choose real dates." };
  if (to < from) return { ok: false, message: "The end date is before the start date." };
  if (from > pakistanToday(now)) return { ok: false, message: "The start date is in the future." };
  if (daysInPeriod(from, to) > MAX_PERIOD_DAYS) return { ok: false, message: "Choose at most 2 years (731 days)." };
  return { ok: true };
}

/** A range from the address, or the default when it is missing or not valid. */
export function rangeOrDefault(range: { from?: string | null; to?: string | null }, now: Date = new Date()): DayRange {
  if (range.from && range.to && validatePeriod(range, now).ok) return { from: range.from, to: range.to };
  return defaultPeriod(now);
}

function dayText(day: string): string {
  const d = parse(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * The text of one time-series row. A week or month at the edge of the period says which part of it is inside:
 * "Week of 3 Nov (from 5 Nov)" or "Nov 2026 (to 20 Nov)".
 */
export function bucketLabel(group: ReportGroup, start: string, end: string, partial: boolean, period?: DayRange): string {
  let base: string;
  if (group === "day") base = `${WEEKDAYS[parse(start).getUTCDay()]} ${dayText(start)}`;
  else if (group === "week") base = `Week of ${dayText(start)}`;
  else base = `${MONTHS[parse(start).getUTCMonth()]} ${parse(start).getUTCFullYear()}`;
  if (!partial || !period) return base;
  const notes: string[] = [];
  if (start < period.from) notes.push(`from ${dayText(period.from)}`);
  if (end > period.to) notes.push(`to ${dayText(period.to)}`);
  return notes.length > 0 ? `${base} (${notes.join(", ")})` : base;
}

/** A day as the owner reads it: "23 Nov 2026". */
export function dayLabel(day: string): string {
  return `${dayText(day)} ${parse(day).getUTCFullYear()}`;
}
