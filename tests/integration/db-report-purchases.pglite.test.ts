import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import { dbReportPurchases, seedMedicine, seedPurchase, voidPurchase } from "../helpers/reports-db";

// The purchase summary (spec FR-009): actual quantity times actual unit cost, cancelled entries left out and counted,
// entries without a cost named and never added to the money, and the same total in every grouping.

let db: PGlite;
let t: Tenant;
let p1: string;
let p2: string;

beforeAll(async () => {
  db = await createTestDb();
  t = await createTenant(db, "purchases");
  p1 = await seedMedicine(db, t.businessId, { name: "Panadol" });
  p2 = await seedMedicine(db, t.businessId, { name: "Brufen" });
  await seedPurchase(db, t.userId, { product: p1, date: "2026-10-30", qty: 10, unitCost: "50.00" }); // 500.00
  await seedPurchase(db, t.userId, { product: p2, date: "2026-11-02", qty: 3, unitCost: "33.33" }); // 99.99
  await seedPurchase(db, t.userId, { product: p1, date: "2026-11-02", qty: 7, unitCost: null }); // no cost
  const cancelled = await seedPurchase(db, t.userId, { product: p2, date: "2026-11-03", qty: 100, unitCost: "999.00" });
  await voidPurchase(db, t.userId, cancelled);
  await seedPurchase(db, t.userId, { product: p1, date: "2026-11-15", qty: 4, unitCost: "12.50" }); // 50.00
}, 90_000);

afterAll(async () => {
  await db.close();
});

describe("purchase summary", () => {
  it("adds quantity times actual unit cost over the entries that have a cost and are not cancelled", async () => {
    const r = await dbReportPurchases(db, t.userId, "2026-10-30", "2026-11-20");
    expect(r.totals).toMatchObject({
      cost: "649.99",
      entries: 4,
      entries_with_cost: 3,
      entries_without_cost: 1,
      quantity_without_cost: 7,
      cancelled_entries_left_out: 1,
      status: "incomplete",
    });
  });

  it("leaves an entry without a cost out of the money, names it and makes the total incomplete", async () => {
    const r = await dbReportPurchases(db, t.userId, "2026-11-02", "2026-11-02", "day");
    expect(r.totals).toMatchObject({ cost: "99.99", entries: 2, entries_without_cost: 1, quantity_without_cost: 7, status: "incomplete" });
    expect(r.series).toHaveLength(1);
    expect(r.series[0]).toMatchObject({ cost: "99.99", entries: 2, entries_without_cost: 1 });
  });

  it("is complete when every entry has a cost, and counts a cancelled entry only as left out", async () => {
    const r = await dbReportPurchases(db, t.userId, "2026-11-03", "2026-11-03");
    expect(r.totals).toMatchObject({ cost: "0.00", entries: 0, cancelled_entries_left_out: 1, status: "complete" });
    expect(r.series).toEqual([]);
    const ok = await dbReportPurchases(db, t.userId, "2026-11-15", "2026-11-15");
    expect(ok.totals).toMatchObject({ cost: "50.00", entries: 1, entries_without_cost: 0, status: "complete" });
  });

  it("adds up to the same total in a day, a week and a month grouping, with partial edge buckets", async () => {
    for (const group of ["day", "week", "month"] as const) {
      const r = await dbReportPurchases(db, t.userId, "2026-10-30", "2026-11-20", group);
      const sum = r.series.reduce((a: number, s: { cost: string }) => a + Math.round(Number(s.cost) * 100), 0);
      expect(sum, group).toBe(64999);
      expect(r.series.reduce((a: number, s: { entries: number }) => a + s.entries, 0), group).toBe(4);
    }
    const month = await dbReportPurchases(db, t.userId, "2026-10-30", "2026-11-20", "month");
    expect(month.series.map((s: { bucket_start: string; cost: string; partial: boolean }) => [String(s.bucket_start), s.cost, s.partial])).toEqual([
      ["2026-10-01", "500.00", true],
      ["2026-11-01", "149.99", true],
    ]);
  });

  it("reports an empty period as no entries and nothing from a tick on the market list", async () => {
    const r = await dbReportPurchases(db, t.userId, "2026-01-01", "2026-01-31");
    expect(r.totals).toMatchObject({ cost: "0.00", entries: 0, entries_with_cost: 0, entries_without_cost: 0, cancelled_entries_left_out: 0, status: "complete" });
    expect(r.series).toEqual([]);
  });

  it("never shows another business's entries", async () => {
    const other = await createTenant(db, "purchases-other");
    const r = await dbReportPurchases(db, other.userId, "2026-10-30", "2026-11-20");
    expect(r.totals.entries).toBe(0);
    expect(r.totals.cost).toBe("0.00");
  });

  it("refuses a bad period like the other reports", async () => {
    await expect(dbReportPurchases(db, t.userId, "2026-11-20", "2026-11-01")).rejects.toThrow(/invalid_period/);
  });
});
