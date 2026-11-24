import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import {
  dbReportSales,
  dbSalesLines,
  insertStore,
  seedIssuedInvoice,
  seedMedicine,
  seedPanadolExample,
  seedPurchase,
  voidPurchase,
} from "../helpers/reports-db";

// The cost rules of Module 010 (spec FR-010 to FR-012, the owner's example of 2026-11-24): a sold line's realized cost
// is the weighted average actual cost of that medicine and unit on the order's market day, nothing from other days;
// its estimated cost is the purchase price saved on the order line.

let db: PGlite;
let t: Tenant;

beforeAll(async () => {
  db = await createTestDb();
  t = await createTenant(db, "costrules");
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("the owner's example: bought 50 sold 55, then bought 58 sold 65", () => {
  it("gives profits of 5 and 7 per unit, and the earlier day does not change when the later purchase exists", async () => {
    const ex = await seedPanadolExample(db, t);
    const day1 = await dbReportSales(db, t.userId, "2026-11-23", "2026-11-23");
    expect(day1.totals).toMatchObject({ sales: "550.00", invoices: 1, lines: 1, quantity: 10 });
    expect(day1.realized).toMatchObject({ cost: "500.00", covered_sales: "550.00", profit: "50.00", missing_lines: 0, status: "complete" });
    const day2 = await dbReportSales(db, t.userId, "2026-11-24", "2026-11-24");
    expect(day2.totals.sales).toBe("650.00");
    expect(day2.realized).toMatchObject({ cost: "580.00", profit: "70.00", status: "complete" });

    // The two days together, in one month: nothing was averaged across days.
    const both = await dbReportSales(db, t.userId, "2026-11-23", "2026-11-24");
    expect(both.realized).toMatchObject({ cost: "1080.00", profit: "120.00" });
    expect(both.totals.sales).toBe("1200.00");

    // The Estimate uses the price saved on the order line (52.00 on both), a different figure.
    expect(both.estimated).toMatchObject({ cost: "1040.00", profit: "160.00", status: "complete" });

    // A late purchase on another day changes nothing for the earlier day.
    await seedPurchase(db, t.userId, { product: ex.product, date: "2026-11-24", qty: 100, unitCost: "99.00" });
    const again = await dbReportSales(db, t.userId, "2026-11-23", "2026-11-23");
    expect(again.realized).toMatchObject({ cost: "500.00", profit: "50.00" });
    void ex;
  });
});

describe("which purchases are used", () => {
  it("averages several purchases of one market day by quantity (10 at 50.00 and 10 at 56.00 give 53.00)", async () => {
    const tenant = await createTenant(db, "avgday");
    const store = await insertStore(db, tenant.businessId, "S");
    const product = await seedMedicine(db, tenant.businessId, { name: "Avg med" });
    await seedPurchase(db, tenant.userId, { product, date: "2026-10-05", qty: 10, unitCost: "50.00" });
    await seedPurchase(db, tenant.userId, { product, date: "2026-10-05", qty: 10, unitCost: "56.00" });
    await seedIssuedInvoice(db, tenant, { storeId: store, date: "2026-10-05", lines: [{ product, qty: 4, price: "70.00" }] });
    const lines = await dbSalesLines(db, tenant.userId, tenant.businessId, "2026-10-05", "2026-10-05");
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].real_unit_cost)).toBe(53);
    expect(Number(lines[0].real_cost)).toBe(212);
    const report = await dbReportSales(db, tenant.userId, "2026-10-05", "2026-10-05");
    expect(report.realized).toMatchObject({ cost: "212.00", profit: "68.00" });
  });

  it("never uses a purchase of another day, a cancelled purchase, a purchase without a cost or a purchase in another unit", async () => {
    const tenant = await createTenant(db, "otherday");
    const store = await insertStore(db, tenant.businessId, "S");
    const product = await seedMedicine(db, tenant.businessId, { name: "Edge med", unit: "strip" });
    // The market day is 2026-10-10. Everything below is a trap.
    await seedPurchase(db, tenant.userId, { product, date: "2026-10-09", qty: 10, unitCost: "40.00" }); // the day before
    await seedPurchase(db, tenant.userId, { product, date: "2026-10-11", qty: 10, unitCost: "60.00" }); // the day after
    const cancelled = await seedPurchase(db, tenant.userId, { product, date: "2026-10-10", qty: 10, unitCost: "45.00" });
    await voidPurchase(db, tenant.userId, cancelled);
    await seedPurchase(db, tenant.userId, { product, date: "2026-10-10", qty: 10, unitCost: null }); // no cost recorded
    await seedPurchase(db, tenant.userId, { product, date: "2026-10-10", unit: "box", qty: 10, unitCost: "400.00" }); // another unit
    await seedIssuedInvoice(db, tenant, { storeId: store, date: "2026-10-10", lines: [{ product, qty: 5, price: "70.00" }] });
    const report = await dbReportSales(db, tenant.userId, "2026-10-10", "2026-10-10");
    expect(report.totals.sales).toBe("350.00");
    expect(report.realized).toMatchObject({ cost: "0.00", covered_sales: "0.00", profit: null, missing_lines: 1, missing_sales: "350.00", status: "incomplete" });
  });

  it("uses the market day of the order, not the invoice day (confirmed on day 1, invoiced on day 3)", async () => {
    const tenant = await createTenant(db, "marketday");
    const store = await insertStore(db, tenant.businessId, "S");
    const product = await seedMedicine(db, tenant.businessId, { name: "Late bill" });
    await seedPurchase(db, tenant.userId, { product, date: "2026-10-01", qty: 10, unitCost: "30.00" });
    await seedPurchase(db, tenant.userId, { product, date: "2026-10-03", qty: 10, unitCost: "90.00" });
    await seedIssuedInvoice(db, tenant, { storeId: store, date: "2026-10-03", marketDate: "2026-10-01", lines: [{ product, qty: 2, price: "50.00" }] });
    const report = await dbReportSales(db, tenant.userId, "2026-10-03", "2026-10-03");
    expect(report.realized).toMatchObject({ cost: "60.00", profit: "40.00" });
  });

  it("reads the market day in Pakistan time (an order confirmed at 22:30 UTC belongs to the next Pakistan day)", async () => {
    const tenant = await createTenant(db, "pktday");
    const store = await insertStore(db, tenant.businessId, "S");
    const product = await seedMedicine(db, tenant.businessId, { name: "Night order" });
    await seedPurchase(db, tenant.userId, { product, date: "2026-10-21", qty: 10, unitCost: "20.00" });
    const seeded = await seedIssuedInvoice(db, tenant, { storeId: store, date: "2026-10-21", lines: [{ product, qty: 1, price: "30.00" }] });
    // 22:30 UTC on 20 Oct is 03:30 on 21 Oct in Pakistan.
    await db.exec(`set session_replication_role = replica`);
    await db.query(`update public.orders set confirmed_at = '2026-10-20T22:30:00Z' where id = $1`, [seeded.orderId]);
    await db.exec(`set session_replication_role = origin`);
    const lines = await dbSalesLines(db, tenant.userId, tenant.businessId, "2026-10-21", "2026-10-21");
    // Found the purchase of 21 Oct (a purchase on 20 Oct would not match), so the market day is the Pakistan day.
    expect(lines[0].real_missing).toBe(false);
    expect(Number(lines[0].real_unit_cost)).toBe(20);
  });
});

describe("the estimate", () => {
  it("uses the price saved on the order line only; a saved price of 0.00 is a real cost and an empty price is missing", async () => {
    const tenant = await createTenant(db, "estimate");
    const store = await insertStore(db, tenant.businessId, "S");
    const free = await seedMedicine(db, tenant.businessId, { name: "Free sample" });
    const none = await seedMedicine(db, tenant.businessId, { name: "No price saved" });
    await seedIssuedInvoice(db, tenant, {
      storeId: store,
      date: "2026-10-12",
      lines: [
        { product: free, qty: 2, price: "10.00", purchase: "0.00" },
        { product: none, qty: 3, price: "20.00", purchase: null },
      ],
    });
    const report = await dbReportSales(db, tenant.userId, "2026-10-12", "2026-10-12");
    expect(report.totals.sales).toBe("80.00");
    expect(report.estimated).toMatchObject({ cost: "0.00", covered_sales: "20.00", profit: "20.00", missing_lines: 1, missing_sales: "60.00", status: "incomplete" });
    // The estimate does not look at purchases, and the realized figure does not look at the saved price.
    expect(report.realized).toMatchObject({ profit: null, missing_lines: 2, status: "incomplete" });
  });

  it("is not changed by a later change of the medicine's own purchase price", async () => {
    const tenant = await createTenant(db, "snapshot");
    const store = await insertStore(db, tenant.businessId, "S");
    const product = await seedMedicine(db, tenant.businessId, { name: "Moving price" });
    await seedIssuedInvoice(db, tenant, { storeId: store, date: "2026-10-13", lines: [{ product, qty: 1, price: "100.00", purchase: "60.00" }] });
    await db.query(`update public.products set purchase_price = 99.00, selling_price = 500.00 where id = $1`, [product]);
    const report = await dbReportSales(db, tenant.userId, "2026-10-13", "2026-10-13");
    expect(report.totals.sales).toBe("100.00");
    expect(report.estimated).toMatchObject({ cost: "60.00", profit: "40.00" });
  });
});
