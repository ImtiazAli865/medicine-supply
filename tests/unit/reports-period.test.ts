import { describe, expect, it } from "vitest";
import {
  addDays,
  bucketLabel,
  dayLabel,
  daysInPeriod,
  defaultPeriod,
  matchPreset,
  monthEnd,
  monthStart,
  pakistanToday,
  presetRange,
  rangeOrDefault,
  validatePeriod,
  weekStart,
} from "@/lib/reports/period";

// A Wednesday in Pakistan: 2026-11-25 at noon.
const NOW = new Date("2026-11-25T07:00:00Z");

describe("Pakistan today", () => {
  it("is the next day when it is already past midnight in Pakistan (23:30 UTC is 04:30 the next day)", () => {
    expect(pakistanToday(new Date("2026-11-24T23:30:00Z"))).toBe("2026-11-25");
    expect(pakistanToday(new Date("2026-11-24T18:59:00Z"))).toBe("2026-11-24");
  });
});

describe("day arithmetic", () => {
  it("adds days across a month, a year end and a leap day", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts both ends of a period", () => {
    expect(daysInPeriod("2026-11-01", "2026-11-01")).toBe(1);
    expect(daysInPeriod("2026-11-01", "2026-11-30")).toBe(30);
    expect(daysInPeriod("2028-02-01", "2028-02-29")).toBe(29);
  });

  it("starts a week on Monday, also across a month and a year", () => {
    expect(weekStart("2026-11-25")).toBe("2026-11-23"); // Wednesday
    expect(weekStart("2026-11-23")).toBe("2026-11-23"); // Monday
    expect(weekStart("2026-11-29")).toBe("2026-11-23"); // Sunday
    expect(weekStart("2027-01-01")).toBe("2026-12-28"); // Friday, the week began in the old year
    expect(weekStart("2026-12-01")).toBe("2026-11-30");
  });

  it("finds the first and last day of a month, a leap February included", () => {
    expect(monthStart("2026-11-25")).toBe("2026-11-01");
    expect(monthEnd("2026-11-25")).toBe("2026-11-30");
    expect(monthEnd("2028-02-10")).toBe("2028-02-29");
    expect(monthEnd("2026-02-10")).toBe("2026-02-28");
    expect(monthEnd("2026-12-05")).toBe("2026-12-31");
  });
});

describe("presets", () => {
  it("resolves today, this week, this month and last month in Pakistan time", () => {
    expect(presetRange("today", NOW)).toEqual({ from: "2026-11-25", to: "2026-11-25" });
    expect(presetRange("this_week", NOW)).toEqual({ from: "2026-11-23", to: "2026-11-25" });
    expect(presetRange("this_month", NOW)).toEqual({ from: "2026-11-01", to: "2026-11-25" });
    expect(presetRange("last_month", NOW)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("gives last month correctly in January (the old year) and after a 31-day month", () => {
    const jan = new Date("2027-01-10T07:00:00Z");
    expect(presetRange("last_month", jan)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    const mar = new Date("2026-03-05T07:00:00Z");
    expect(presetRange("last_month", mar)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("uses this month so far as the default", () => {
    expect(defaultPeriod(NOW)).toEqual({ from: "2026-11-01", to: "2026-11-25" });
  });

  it("recognises a preset and says nothing for a custom range", () => {
    expect(matchPreset({ from: "2026-11-01", to: "2026-11-25" }, NOW)).toBe("this_month");
    expect(matchPreset({ from: "2026-11-02", to: "2026-11-25" }, NOW)).toBeNull();
  });
});

describe("validatePeriod", () => {
  const ok = (from: string, to: string) => validatePeriod({ from, to }, NOW);

  it("accepts a normal period, one day and a period that reaches into the future", () => {
    expect(ok("2026-11-01", "2026-11-25")).toEqual({ ok: true });
    expect(ok("2026-11-25", "2026-11-25")).toEqual({ ok: true });
    expect(ok("2026-11-20", "2026-12-31")).toEqual({ ok: true });
  });

  it("refuses a missing date, a date that does not exist and an end before the start", () => {
    expect(validatePeriod({ from: "2026-11-01" }, NOW)).toEqual({ ok: false, message: "Choose a start date and an end date." });
    expect(validatePeriod({ from: null, to: null }, NOW).ok).toBe(false);
    expect(ok("2026-02-30", "2026-03-05")).toEqual({ ok: false, message: "Choose real dates." });
    expect(ok("2026-11-10", "2026-11-09")).toEqual({ ok: false, message: "The end date is before the start date." });
  });

  it("refuses a period that starts in the future", () => {
    expect(ok("2026-11-26", "2026-11-30")).toEqual({ ok: false, message: "The start date is in the future." });
  });

  it("accepts exactly 731 days and refuses 732", () => {
    expect(ok("2024-11-25", "2026-11-25")).toEqual({ ok: true }); // 2024-11-25 to 2026-11-25 is 731 days counting both ends
    expect(daysInPeriod("2024-11-25", "2026-11-25")).toBe(731);
    expect(ok("2024-11-24", "2026-11-25")).toEqual({ ok: false, message: "Choose at most 2 years (731 days)." });
  });
});

describe("rangeOrDefault", () => {
  it("keeps a valid range and falls back to this month for a bad or missing one", () => {
    expect(rangeOrDefault({ from: "2026-11-02", to: "2026-11-10" }, NOW)).toEqual({ from: "2026-11-02", to: "2026-11-10" });
    expect(rangeOrDefault({ from: "2026-11-10", to: "2026-11-02" }, NOW)).toEqual({ from: "2026-11-01", to: "2026-11-25" });
    expect(rangeOrDefault({}, NOW)).toEqual({ from: "2026-11-01", to: "2026-11-25" });
  });
});

describe("labels", () => {
  it("labels a day, a week and a month", () => {
    expect(bucketLabel("day", "2026-11-23", "2026-11-23", false)).toBe("Mon 23 Nov");
    expect(bucketLabel("week", "2026-11-23", "2026-11-29", false)).toBe("Week of 23 Nov");
    expect(bucketLabel("month", "2026-11-01", "2026-11-30", false)).toBe("Nov 2026");
  });

  it("says which part of an edge week or month is inside the period", () => {
    const period = { from: "2026-11-05", to: "2026-11-20" };
    expect(bucketLabel("week", "2026-11-02", "2026-11-08", true, period)).toBe("Week of 2 Nov (from 5 Nov)");
    expect(bucketLabel("week", "2026-11-16", "2026-11-22", true, period)).toBe("Week of 16 Nov (to 20 Nov)");
    expect(bucketLabel("month", "2026-11-01", "2026-11-30", true, period)).toBe("Nov 2026 (from 5 Nov, to 20 Nov)");
  });

  it("writes a full day for a heading", () => {
    expect(dayLabel("2026-11-23")).toBe("23 Nov 2026");
  });
});
