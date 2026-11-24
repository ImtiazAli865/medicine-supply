import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";
import {
  dbReportSales,
  insertRawInvoice,
  insertStore,
  seedBareOrder,
  seedIssuedInvoice,
  seedMedicine,
  seedPurchase,
} from "../helpers/reports-db";

// What counts as sales (spec FR-005, FR-006): issued invoices only, from their frozen lines, by invoice date, billed
// quantity only; and what is left out is named.

let db: PGlite;
let t: Tenant;
let store: string;
let product: string;

beforeAll(async () => {
  db = await createTestDb();
  t = await createTenant(db, "salesrules");
  store = await insertStore(db, t.businessId, "Al Madina");
  product = await seedMedicine(db, t.businessId, { name: "Panadol", strength: "500 mg" });
}, 60_000);

afterAll(async () => {
  await db.close();
});

const sum = (xs: string[]) => xs.reduce((a, b) => a + Math.round(Number(b) * 100), 0) / 100;

describe("sales of a period", () => {
  it("equal the sum of the issued invoice totals and the sum of their line totals, and leave out cancelled invoices, drafts and cancelled orders", async () => {
    const a = await seedIssuedInvoice(db, t, { storeId: store, date: "2026-09-10", lines: [{ product, qty: 10, price: "12.50" }] });
    const b = await seedIssuedInvoice(db, t, { storeId: store, date: "2026-09-11", lines: [{ product, qty: 3, price: "99.99" }] });
    await seedIssuedInvoice(db, t, { storeId: store, date: "2026-09-12", lines: [{ product, qty: 2, price: "70.00" }], status: "cancelled" });
    await seedIssuedInvoice(db, t, { storeId: store, date: "2026-09-12", lines: [{ product, qty: 1, price: "70.00" }], status: "draft" });
    const report = await dbReportSales(db, t.userId, "2026-09-10", "2026-09-12");
    expect(report.totals.invoices).toBe(2);
    expect(report.totals.sales).toBe(sum([a.total, b.total]).toFixed(2));
    expect(report.totals.sales).toBe("424.97"); // 125.00 + 299.97
    expect(report.excluded.cancelled_invoices).toBe(1);
    // The draft was created today (a draft has no invoice date), so it is not in a September period.
    expect(report.excluded.draft_invoices).toBe(0);
    // The same total from the lines of the series.
    const lineTotal = report.series.reduce((acc: number, s: { sales: string }) => acc + Math.round(Number(s.sales) * 100), 0) / 100;
    expect(lineTotal).toBe(424.97);
    const grand = await db.query<{ s: string }>(
      `select sum(grand_total)::text as s from public.invoices where business_id = $1 and status = 'issued' and invoice_date between '2026-09-10' and '2026-09-12'`,
      [t.businessId],
    );
    expect(report.totals.sales).toBe(Number(grand.rows[0].s).toFixed(2));
  });

  it("counts a draft invoice created in the period in the excluded count, and includes both edge days and neither neighbour", async () => {
    const tenant = await createTenant(db, "edges");
    const s = await insertStore(db, tenant.businessId, "S");
    const p = await seedMedicine(db, tenant.businessId, { name: "Edge" });
    await seedIssuedInvoice(db, tenant, { storeId: s, date: "2026-08-09", lines: [{ product: p, qty: 1, price: "1.00" }] }); // the day before
    await seedIssuedInvoice(db, tenant, { storeId: s, date: "2026-08-10", lines: [{ product: p, qty: 1, price: "2.00" }] }); // first day
    await seedIssuedInvoice(db, tenant, { storeId: s, date: "2026-08-20", lines: [{ product: p, qty: 1, price: "4.00" }] }); // last day
    await seedIssuedInvoice(db, tenant, { storeId: s, date: "2026-08-21", lines: [{ product: p, qty: 1, price: "8.00" }] }); // the day after
    const draft = await seedIssuedInvoice(db, tenant, { storeId: s, date: "2026-08-15", lines: [{ product: p, qty: 1, price: "16.00" }], status: "draft" });
    // Move the draft's creation day into the period (its creation day is what a draft is counted by).
    await db.exec(`set session_replication_role = replica`);
    await db.query(`update public.invoices set created_at = '2026-08-15T08:00:00Z' where id = $1`, [draft.invoiceId]);
    await db.exec(`set session_replication_role = origin`);
    const report = await dbReportSales(db, tenant.userId, "2026-08-10", "2026-08-20");
    expect(report.totals).toMatchObject({ sales: "6.00", invoices: 2 });
    expect(report.excluded).toEqual({ cancelled_invoices: 0, draft_invoices: 1 });
  });

  it("is not changed by a later change of the catalog selling price", async () => {
    const tenant = await createTenant(db, "frozen");
    const s = await insertStore(db, tenant.businessId, "S");
    const p = await seedMedicine(db, tenant.businessId, { name: "Frozen" });
    await seedIssuedInvoice(db, tenant, { storeId: s, date: "2026-07-01", lines: [{ product: p, qty: 4, price: "25.00" }] });
    await db.query(`update public.products set selling_price = 999.00 where id = $1`, [p]);
    const report = await dbReportSales(db, tenant.userId, "2026-07-01", "2026-07-01");
    expect(report.totals.sales).toBe("100.00");
  });

  it("uses the billed quantity, never the ordered one", async () => {
    const tenant = await createTenant(db, "billed");
    const s = await insertStore(db, tenant.businessId, "S");
    const p = await seedMedicine(db, tenant.businessId, { name: "Short delivery" });
    await seedPurchase(db, tenant.userId, { product: p, date: "2026-07-02", qty: 100, unitCost: "6.00" });
    await seedIssuedInvoice(db, tenant, { storeId: s, date: "2026-07-02", lines: [{ product: p, qty: 10, delivered: 4, price: "10.00", purchase: "7.00" }] });
    const report = await dbReportSales(db, tenant.userId, "2026-07-02", "2026-07-02");
    expect(report.totals).toMatchObject({ sales: "40.00", quantity: 4, lines: 1 });
    expect(report.realized).toMatchObject({ cost: "24.00", profit: "16.00" });
    expect(report.estimated).toMatchObject({ cost: "28.00", profit: "12.00" });
  });

  it("adds nothing for a line billed with quantity 0 and does not count it as a missing cost", async () => {
    const tenant = await createTenant(db, "zero");
    const s = await insertStore(db, tenant.businessId, "S");
    const p1 = await seedMedicine(db, tenant.businessId, { name: "Billed" });
    const p2 = await seedMedicine(db, tenant.businessId, { name: "Not delivered" });
    await seedPurchase(db, tenant.userId, { product: p1, date: "2026-07-03", qty: 10, unitCost: "5.00" });
    await seedIssuedInvoice(db, tenant, {
      storeId: s,
      date: "2026-07-03",
      lines: [
        { product: p1, qty: 2, price: "9.00", purchase: "5.00" },
        { product: p2, qty: 5, delivered: 0, price: "9.00" },
      ],
    });
    const report = await dbReportSales(db, tenant.userId, "2026-07-03", "2026-07-03");
    expect(report.totals).toMatchObject({ sales: "18.00", lines: 1, quantity: 2 });
    expect(report.realized).toMatchObject({ missing_lines: 0, status: "complete" });
    expect(report.estimated).toMatchObject({ missing_lines: 0, status: "complete" });
  });

  it("counts an issued invoice that is not in the account (issued before the store accounts module)", async () => {
    const tenant = await createTenant(db, "legacy");
    const s = await insertStore(db, tenant.businessId, "S");
    const p = await seedMedicine(db, tenant.businessId, { name: "Legacy" });
    const inv = await seedIssuedInvoice(db, tenant, { storeId: s, date: "2026-07-04", lines: [{ product: p, qty: 1, price: "33.00" }] });
    await db.exec(`set session_replication_role = replica`);
    await db.query(
      `update public.invoices set in_account = false, summary_previous = null, summary_payment = null, summary_due = null where id = $1`,
      [inv.invoiceId],
    );
    await db.exec(`set session_replication_role = origin`);
    const report = await dbReportSales(db, tenant.userId, "2026-07-04", "2026-07-04");
    expect(report.totals.sales).toBe("33.00");
  });

  it("counts a billed typed line (no medicine) in sales and marks it cost missing for both figures", async () => {
    const tenant = await createTenant(db, "typed");
    const s = await insertStore(db, tenant.businessId, "S");
    const p = await seedMedicine(db, tenant.businessId, { name: "Parent" });
    const { orderId } = await seedBareOrder(db, tenant, s, p, "2026-07-05");
    await insertRawInvoice(db, tenant, { orderId, storeId: s, date: "2026-07-05", lines: [{ productId: null, name: "Noran 20mg cap", qty: 3, price: "40.00" }] });
    const report = await dbReportSales(db, tenant.userId, "2026-07-05", "2026-07-05");
    expect(report.totals).toMatchObject({ sales: "120.00", invoices: 1, lines: 1 });
    expect(report.estimated).toMatchObject({ profit: null, missing_lines: 1, missing_sales: "120.00", status: "incomplete" });
    expect(report.realized).toMatchObject({ profit: null, missing_lines: 1, missing_sales: "120.00", status: "incomplete" });
  });

  it("answers an empty period with zero sales and no profit (not available), not an error", async () => {
    const tenant = await createTenant(db, "empty");
    const report = await dbReportSales(db, tenant.userId, "2026-01-01", "2026-01-31");
    expect(report.totals).toMatchObject({ sales: "0.00", invoices: 0, lines: 0, quantity: 0 });
    expect(report.estimated).toMatchObject({ profit: null, status: "complete", missing_lines: 0 });
    expect(report.series).toEqual([]);
    expect(report.excluded).toEqual({ cancelled_invoices: 0, draft_invoices: 0 });
  });

  it("is a read: the function can run in a read-only transaction", async () => {
    const out = await withRole(db, "authenticated", t.userId, async () => {
      await db.exec("begin read only");
      try {
        const res = await db.query<{ r: unknown }>(`select public.report_sales('2026-09-10', '2026-09-12', 'day') as r`);
        return res.rows[0].r;
      } finally {
        await db.exec("rollback");
      }
    });
    expect((out as { totals: { sales: string } }).totals.sales).toBe("424.97");
  });
});
