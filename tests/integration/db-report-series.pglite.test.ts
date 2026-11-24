import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import { dbReportSales, insertStore, seedIssuedInvoice, seedMedicine } from "../helpers/reports-db";

// Day, week and month series (spec FR-003): every grouping adds up to the same total, edge buckets say they are
// partial, only buckets with data exist, and a bad period is refused.

let db: PGlite;
let t: Tenant;

const DAYS: Array<[string, string]> = [
  ["2026-10-30", "10.00"], // Friday: the week of Mon 26 Oct, the month of October
  ["2026-11-02", "20.00"], // Monday
  ["2026-11-03", "40.00"], // Tuesday, the same week
  ["2026-11-15", "80.00"], // Sunday: the week of Mon 9 Nov
  ["2026-11-20", "160.00"], // Friday: the week of Mon 16 Nov
];

beforeAll(async () => {
  db = await createTestDb();
  t = await createTenant(db, "series");
  const store = await insertStore(db, t.businessId, "S");
  const p = await seedMedicine(db, t.businessId, { name: "Series medicine" });
  for (const [date, price] of DAYS) await seedIssuedInvoice(db, t, { storeId: store, date, lines: [{ product: p, qty: 1, price }] });
}, 90_000);

afterAll(async () => {
  await db.close();
});

const cents = (s: string) => Math.round(Number(s) * 100);
const total = (series: Array<{ sales: string }>) => series.reduce((a, b) => a + cents(b.sales), 0);

describe("series", () => {
  it("adds up to the same total in a day, a week and a month grouping", async () => {
    for (const group of ["day", "week", "month"] as const) {
      const r = await dbReportSales(db, t.userId, "2026-10-30", "2026-11-20", group);
      expect(r.totals.sales, group).toBe("310.00");
      expect(total(r.series), group).toBe(31000);
      expect(r.series.reduce((a: number, s: { invoices: number }) => a + s.invoices, 0), group).toBe(5);
    }
  });

  it("lists only the days that have sales", async () => {
    const r = await dbReportSales(db, t.userId, "2026-10-30", "2026-11-20", "day");
    expect(r.series.map((s: { bucket_start: string }) => String(s.bucket_start))).toEqual(["2026-10-30", "2026-11-02", "2026-11-03", "2026-11-15", "2026-11-20"]);
    expect(r.series.every((s: { partial: boolean }) => !s.partial)).toBe(true);
  });

  it("starts a week on Monday and marks the first week partial (its Monday is before the period)", async () => {
    const r = await dbReportSales(db, t.userId, "2026-10-30", "2026-11-20", "week");
    expect(r.series.map((s: { bucket_start: string; bucket_end: string; sales: string; partial: boolean }) => [String(s.bucket_start), String(s.bucket_end), s.sales, s.partial])).toEqual([
      ["2026-10-26", "2026-11-01", "10.00", true],
      ["2026-11-02", "2026-11-08", "60.00", false],
      ["2026-11-09", "2026-11-15", "80.00", false],
      ["2026-11-16", "2026-11-22", "160.00", true], // ends on Sunday 22 Nov, after the period end of 20 Nov
    ]);
  });

  it("splits a month grouping at the month end and marks both edge months partial", async () => {
    const r = await dbReportSales(db, t.userId, "2026-10-30", "2026-11-20", "month");
    expect(r.series.map((s: { bucket_start: string; bucket_end: string; sales: string; partial: boolean }) => [String(s.bucket_start), String(s.bucket_end), s.sales, s.partial])).toEqual([
      ["2026-10-01", "2026-10-31", "10.00", true],
      ["2026-11-01", "2026-11-30", "300.00", true],
    ]);
  });

  it("does not mark a whole month partial when the period covers it exactly", async () => {
    const r = await dbReportSales(db, t.userId, "2026-11-01", "2026-11-30", "month");
    expect(r.series).toHaveLength(1);
    expect(r.series[0].partial).toBe(false);
    expect(r.series[0].sales).toBe("300.00");
  });

  it("also splits across a year end", async () => {
    const tenant = await createTenant(db, "yearend");
    const store = await insertStore(db, tenant.businessId, "S");
    const p = await seedMedicine(db, tenant.businessId, { name: "New year" });
    await seedIssuedInvoice(db, tenant, { storeId: store, date: "2025-12-31", lines: [{ product: p, qty: 1, price: "5.00" }] });
    await seedIssuedInvoice(db, tenant, { storeId: store, date: "2026-01-01", lines: [{ product: p, qty: 1, price: "7.00" }] });
    const month = await dbReportSales(db, tenant.userId, "2025-12-01", "2026-01-31", "month");
    expect(month.series.map((s: { bucket_start: string; sales: string }) => [String(s.bucket_start), s.sales])).toEqual([["2025-12-01", "5.00"], ["2026-01-01", "7.00"]]);
    const week = await dbReportSales(db, tenant.userId, "2025-12-01", "2026-01-31", "week");
    // 31 Dec 2025 is a Wednesday and 1 Jan 2026 a Thursday: both are in the week of Monday 29 Dec 2025.
    expect(week.series).toHaveLength(1);
    expect(String(week.series[0].bucket_start)).toBe("2025-12-29");
    expect(week.series[0].sales).toBe("12.00");
  });
});

describe("period rules", () => {
  const refuse = async (from: string | null, to: string | null, group = "day") => {
    await expect(dbReportSales(db, t.userId, from as string, to as string, group as "day")).rejects.toThrow(/invalid_period/);
  };

  it("refuses an end before the start, a start in the future, more than 731 days, a missing date and a bad group", async () => {
    await refuse("2026-11-20", "2026-11-01");
    await refuse("2999-01-01", "2999-01-31");
    await refuse("2024-01-01", "2026-11-01"); // over 731 days
    await refuse(null, "2026-11-01");
    await refuse("2026-11-01", null);
    await refuse("2026-11-01", "2026-11-20", "year");
  });

  it("accepts exactly 731 days and a period that ends in the future", async () => {
    await expect(dbReportSales(db, t.userId, "2024-11-25", "2026-11-25")).resolves.toBeTruthy();
    await expect(dbReportSales(db, t.userId, "2026-11-20", "2999-01-01")).rejects.toThrow(/invalid_period/); // 731 days is the limit even for a future end
    await expect(dbReportSales(db, t.userId, "2026-11-20", "2026-12-31")).resolves.toBeTruthy();
  });
});
