import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import {
  bulkInvoices,
  dbReportByMedicine,
  dbReportByStore,
  dbReportCostMissing,
  dbReportPurchases,
  dbReportSales,
  insertStore,
  seedMedicine,
} from "../helpers/reports-db";

// Correctness at size (spec FR-024, SC-005): 5,000 issued invoices with 10 lines each (50,000 lines) over 90 days. The
// totals are exact and every list adds up to the summary. The time limit here is a loose ceiling that only catches an
// accidental quadratic plan on this test engine (PGlite is much slower than PostgreSQL); the real budget of 2 seconds
// is measured on the Supabase test project in tests/integration/reports-scale.test.ts.

const END = "2026-11-20";
const FROM = "2026-08-23"; // 90 days ending 20 Nov
const CEILING_MS = 20_000;

let db: PGlite;
let t: Tenant;
const times: Record<string, number> = {};

async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await run();
  times[label] = Math.round(performance.now() - start);
  return result;
}

beforeAll(async () => {
  db = await createTestDb();
  t = await createTenant(db, "scale");
  const stores: string[] = [];
  for (let i = 0; i < 20; i += 1) stores.push(await insertStore(db, t.businessId, `Store ${String(i).padStart(2, "0")}`));
  const products: string[] = [];
  for (let i = 0; i < 200; i += 1) products.push(await seedMedicine(db, t.businessId, { name: `Medicine ${String(i).padStart(3, "0")}`, strength: `${100 + i} mg` }));
  await bulkInvoices(db, t, { storeIds: stores, products, invoices: 5000, linesEach: 10, days: 90, endDate: END });
}, 300_000);

afterAll(async () => {
  console.info("report scale timings (PGlite, ms):", JSON.stringify(times));
  await db.close();
});

describe("5,000 invoices, 50,000 lines", () => {
  it("answers the sales report exactly and within the ceiling", async () => {
    const r = await timed("sales (whole range)", () => dbReportSales(db, t.userId, FROM, END, "day"));
    expect(r.totals.invoices).toBe(5000);
    expect(r.totals.lines).toBe(50000);
    const sql = await db.query<{ s: string }>(`select sum(grand_total)::text as s from public.invoices where business_id = $1 and status = 'issued'`, [t.businessId]);
    expect(r.totals.sales).toBe(Number(sql.rows[0].s).toFixed(2));
    expect(r.series.length).toBe(90);
    const seriesCents = r.series.reduce((a: number, s: { sales: string }) => a + Math.round(Number(s.sales) * 100), 0);
    expect(seriesCents).toBe(Math.round(Number(r.totals.sales) * 100));
    expect(times["sales (whole range)"]).toBeLessThan(CEILING_MS);
    // Every product has a costed purchase on every day, so the realized figure is complete.
    expect(r.realized.status).toBe("complete");
    expect(r.estimated.status).toBe("complete");
  });

  it("answers the week and month groupings to the same total, and one month and one day quickly", async () => {
    const whole = await dbReportSales(db, t.userId, FROM, END, "day");
    for (const group of ["week", "month"] as const) {
      const r = await timed(`sales (${group})`, () => dbReportSales(db, t.userId, FROM, END, group));
      expect(r.totals.sales).toBe(whole.totals.sales);
      expect(times[`sales (${group})`]).toBeLessThan(CEILING_MS);
    }
    const month = await timed("sales (one month)", () => dbReportSales(db, t.userId, "2026-11-01", END, "day"));
    expect(month.totals.invoices).toBeGreaterThan(0);
    const day = await timed("sales (one day)", () => dbReportSales(db, t.userId, END, END, "day"));
    expect(day.totals.invoices).toBeGreaterThanOrEqual(55); // 5,000 invoices over 90 days is 55 or 56 a day
    expect(times["sales (one month)"]).toBeLessThan(CEILING_MS);
    expect(times["sales (one day)"]).toBeLessThan(CEILING_MS);
  });

  it("adds the store rows and the medicine rows up to the summary, with first pages that are quick", async () => {
    const summary = await dbReportSales(db, t.userId, FROM, END, "day");
    const stores = await timed("stores (first page)", () => dbReportByStore(db, t.userId, { from: FROM, to: END, limit: 50 }));
    expect(stores.total).toBe(20);
    const storeCents = (stores.items as Array<{ sales: string }>).reduce((a, i) => a + Math.round(Number(i.sales) * 100), 0);
    expect(storeCents).toBe(Math.round(Number(summary.totals.sales) * 100));
    const meds = await timed("medicines (first page)", () => dbReportByMedicine(db, t.userId, { from: FROM, to: END, limit: 50 }));
    expect(meds.total).toBe(200);
    expect(meds.totals.sales).toBe(summary.totals.sales);
    const all = await timed("medicines (all, as the export)", () => dbReportByMedicine(db, t.userId, { from: FROM, to: END, limit: 5001 }));
    const medCents = (all.items as Array<{ sales: string }>).reduce((a, i) => a + Math.round(Number(i.sales) * 100), 0);
    expect(medCents).toBe(Math.round(Number(summary.totals.sales) * 100));
    for (const label of ["stores (first page)", "medicines (first page)", "medicines (all, as the export)"]) expect(times[label], label).toBeLessThan(CEILING_MS);
  });

  it("answers cost missing and purchases quickly (nothing is missing here)", async () => {
    const missing = await timed("cost missing", () => dbReportCostMissing(db, t.userId, FROM, END));
    expect(missing.total).toBe(0);
    const purchases = await timed("purchases", () => dbReportPurchases(db, t.userId, FROM, END, "day"));
    expect(purchases.totals.entries).toBe(200 * 90);
    expect(times["cost missing"]).toBeLessThan(CEILING_MS);
    expect(times["purchases"]).toBeLessThan(CEILING_MS);
  });
});
