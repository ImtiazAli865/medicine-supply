import { describe, expect, it } from "vitest";
import { formatPakistanDateTime, formatPakistanTime, pakistanDayRange, todayInPakistan } from "@/lib/orders/dates";

describe("pakistanDayRange", () => {
  it("covers one local day, from 00:00 to the next 00:00 in Pakistan time (UTC+5)", () => {
    expect(pakistanDayRange("2026-11-06", "2026-11-06")).toEqual({
      from: "2026-11-05T19:00:00.000Z",
      toExclusive: "2026-11-06T19:00:00.000Z",
    });
  });

  it("covers a range of days and crosses month ends", () => {
    expect(pakistanDayRange("2026-11-30", "2026-12-01")).toEqual({
      from: "2026-11-29T19:00:00.000Z",
      toExclusive: "2026-12-01T19:00:00.000Z",
    });
  });

  it("allows an open end", () => {
    expect(pakistanDayRange("2026-11-06", undefined)).toEqual({ from: "2026-11-05T19:00:00.000Z", toExclusive: undefined });
    expect(pakistanDayRange(undefined, "2026-11-06")).toEqual({ from: undefined, toExclusive: "2026-11-06T19:00:00.000Z" });
  });

  it("rejects text that is not a real date or a reversed range", () => {
    expect(() => pakistanDayRange("2026-13-01", undefined)).toThrow();
    expect(() => pakistanDayRange("06-11-2026", undefined)).toThrow();
    expect(() => pakistanDayRange("2026-02-30", undefined)).toThrow();
    expect(() => pakistanDayRange("2026-11-07", "2026-11-06")).toThrow();
  });
});

describe("todayInPakistan", () => {
  it("uses the Pakistan calendar day, not the UTC day", () => {
    // 20:00 UTC on 5 Nov is already 01:00 on 6 Nov in Pakistan.
    expect(todayInPakistan(new Date("2026-11-05T20:00:00.000Z"))).toBe("2026-11-06");
    expect(todayInPakistan(new Date("2026-11-05T18:59:00.000Z"))).toBe("2026-11-05");
  });
});

describe("formatting", () => {
  it("shows the time of day in Pakistan time as HH:MM", () => {
    expect(formatPakistanTime("2026-11-06T09:05:00.000Z")).toBe("14:05");
    expect(formatPakistanTime("2026-11-05T19:30:00.000Z")).toBe("00:30");
  });

  it("shows a short date and time", () => {
    expect(formatPakistanDateTime("2026-11-06T09:05:00.000Z")).toBe("6 Nov 2026, 14:05");
  });

  it("does not throw on an invalid value", () => {
    expect(formatPakistanTime("not a date")).toBe("");
    expect(formatPakistanDateTime("")).toBe("");
  });
});
