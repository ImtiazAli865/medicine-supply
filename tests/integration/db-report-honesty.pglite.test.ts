import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb } from "../helpers/pglite";
import { dbReportSales, insertStore, seedIssuedInvoice, seedMedicine, seedPurchase } from "../helpers/reports-db";

// Honesty and exactness (spec FR-011, FR-013, SC-002): a figure with a missing cost is Incomplete and says how much is
// missing, a profit is never a confident zero, and money is exact.

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("incomplete figures", () => {
  it("marks a figure Incomplete with the count and the sales of the lines without a cost, and computes profit over the costed lines only", async () => {
    const t = await createTenant(db, "incomplete");
    const store = await insertStore(db, t.businessId, "S");
    const costed = await seedMedicine(db, t.businessId, { name: "Costed" });
    const unknown = await seedMedicine(db, t.businessId, { name: "Unknown cost" });
    await seedPurchase(db, t.userId, { product: costed, date: "2026-06-01", qty: 10, unitCost: "40.00" });
    await seedIssuedInvoice(db, t, {
      storeId: store,
      date: "2026-06-01",
      lines: [
        { product: costed, qty: 5, price: "50.00", purchase: "42.00" },
        { product: unknown, qty: 2, price: "300.00", purchase: null },
      ],
    });
    const r = await dbReportSales(db, t.userId, "2026-06-01", "2026-06-01");
    expect(r.totals.sales).toBe("850.00");
    expect(r.realized).toMatchObject({ cost: "200.00", covered_sales: "250.00", profit: "50.00", missing_lines: 1, missing_sales: "600.00", status: "incomplete" });
    expect(r.estimated).toMatchObject({ cost: "210.00", covered_sales: "250.00", profit: "40.00", missing_lines: 1, missing_sales: "600.00", status: "incomplete" });
    // The two figures are separate fields and disagree (the cost differs: 40.00 actual, 42.00 saved).
    expect(r.realized.profit).not.toBe(r.estimated.profit);
  });

  it("is Complete only when every billed line has a cost", async () => {
    const t = await createTenant(db, "complete");
    const store = await insertStore(db, t.businessId, "S");
    const p = await seedMedicine(db, t.businessId, { name: "All known" });
    await seedPurchase(db, t.userId, { product: p, date: "2026-06-02", qty: 10, unitCost: "10.00" });
    await seedIssuedInvoice(db, t, { storeId: store, date: "2026-06-02", lines: [{ product: p, qty: 3, price: "15.00", purchase: "10.00" }] });
    const r = await dbReportSales(db, t.userId, "2026-06-02", "2026-06-02");
    expect(r.realized).toMatchObject({ profit: "15.00", missing_lines: 0, missing_sales: "0.00", status: "complete" });
    expect(r.estimated).toMatchObject({ profit: "15.00", missing_lines: 0, status: "complete" });
  });

  it("shows no profit at all (null, never 0.00) when no line has a cost", async () => {
    const t = await createTenant(db, "nocost");
    const store = await insertStore(db, t.businessId, "S");
    const p = await seedMedicine(db, t.businessId, { name: "Nothing known" });
    await seedIssuedInvoice(db, t, { storeId: store, date: "2026-06-03", lines: [{ product: p, qty: 2, price: "80.00" }] });
    const r = await dbReportSales(db, t.userId, "2026-06-03", "2026-06-03");
    expect(r.realized.profit).toBeNull();
    expect(r.estimated.profit).toBeNull();
    expect(r.realized.cost).toBe("0.00");
  });

  it("shows a real loss as a negative profit and a real profit of zero as 0.00", async () => {
    const t = await createTenant(db, "loss");
    const store = await insertStore(db, t.businessId, "S");
    const loss = await seedMedicine(db, t.businessId, { name: "Sold at a loss" });
    const even = await seedMedicine(db, t.businessId, { name: "Sold at cost" });
    await seedPurchase(db, t.userId, { product: loss, date: "2026-06-04", qty: 10, unitCost: "100.00" });
    await seedPurchase(db, t.userId, { product: even, date: "2026-06-04", qty: 10, unitCost: "20.00" });
    await seedIssuedInvoice(db, t, {
      storeId: store,
      date: "2026-06-04",
      lines: [
        { product: loss, qty: 1, price: "90.00" },
        { product: even, qty: 1, price: "20.00" },
      ],
    });
    const r = await dbReportSales(db, t.userId, "2026-06-04", "2026-06-04");
    expect(r.realized.profit).toBe("-10.00");
    const only = await seedMedicine(db, t.businessId, { name: "Break even only" });
    await seedPurchase(db, t.userId, { product: only, date: "2026-06-05", qty: 1, unitCost: "20.00" });
    await seedIssuedInvoice(db, t, { storeId: store, date: "2026-06-05", lines: [{ product: only, qty: 1, price: "20.00" }] });
    const zero = await dbReportSales(db, t.userId, "2026-06-05", "2026-06-05");
    expect(zero.realized.profit).toBe("0.00");
  });
});

describe("exact money", () => {
  it("keeps a line cost unrounded and rounds each reported figure once (a weighted cost of 53.3333… per unit)", async () => {
    const t = await createTenant(db, "exact");
    const store = await insertStore(db, t.businessId, "S");
    const p = await seedMedicine(db, t.businessId, { name: "Thirds" });
    // 1 at 50.00, 1 at 50.00 and 1 at 60.00: total 160.00 over 3 units = 53.3333… each.
    await seedPurchase(db, t.userId, { product: p, date: "2026-06-06", qty: 1, unitCost: "50.00" });
    await seedPurchase(db, t.userId, { product: p, date: "2026-06-06", qty: 1, unitCost: "50.00" });
    await seedPurchase(db, t.userId, { product: p, date: "2026-06-06", qty: 1, unitCost: "60.00" });
    // Three separate invoices of 1 unit each: each line costs 53.3333…, the three together exactly 160.00.
    for (let i = 0; i < 3; i += 1) {
      await seedIssuedInvoice(db, t, { storeId: store, date: "2026-06-06", lines: [{ product: p, qty: 1, price: "70.00" }] });
    }
    const r = await dbReportSales(db, t.userId, "2026-06-06", "2026-06-06");
    expect(r.totals.sales).toBe("210.00");
    expect(r.realized.cost).toBe("160.00"); // not 159.99 or 160.01: no per-line rounding
    expect(r.realized.profit).toBe("50.00");
    // One day bucket holds all three lines, rounded once.
    expect(r.series).toHaveLength(1);
    expect(r.series[0].realized.cost).toBe("160.00");
  });

  it("rounds half away from zero once (an amount of 0.005 per unit over 1 unit is 0.01 and a loss of 0.005 is -0.01)", async () => {
    const t = await createTenant(db, "rounding");
    const store = await insertStore(db, t.businessId, "S");
    const p = await seedMedicine(db, t.businessId, { name: "Half paisa" });
    // 2 units bought at 0.01 and 1 unit at 0.00 average to 0.00666…; one unit costs 0.0067 and rounds to 0.01.
    await seedPurchase(db, t.userId, { product: p, date: "2026-06-07", qty: 2, unitCost: "0.01" });
    await seedPurchase(db, t.userId, { product: p, date: "2026-06-07", qty: 1, unitCost: "0.00" });
    await seedIssuedInvoice(db, t, { storeId: store, date: "2026-06-07", lines: [{ product: p, qty: 1, price: "1.00" }] });
    const r = await dbReportSales(db, t.userId, "2026-06-07", "2026-06-07");
    expect(r.realized.cost).toBe("0.01");
    expect(r.realized.profit).toBe("0.99");
  });

  it("handles large amounts without losing a paisa", async () => {
    const t = await createTenant(db, "large");
    const store = await insertStore(db, t.businessId, "S");
    const p = await seedMedicine(db, t.businessId, { name: "Expensive" });
    await seedPurchase(db, t.userId, { product: p, date: "2026-06-08", qty: 100000, unitCost: "9999999.99" });
    await seedIssuedInvoice(db, t, { storeId: store, date: "2026-06-08", lines: [{ product: p, qty: 100000, price: "9999999.99" }] });
    const r = await dbReportSales(db, t.userId, "2026-06-08", "2026-06-08");
    expect(r.totals.sales).toBe("999999999000.00");
    expect(r.realized).toMatchObject({ cost: "999999999000.00", profit: "0.00" });
  });
});
