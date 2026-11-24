import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import { dbReportByStore, dbReportSales, insertStore, seedIssuedInvoice, seedMedicine, seedPurchase } from "../helpers/reports-db";

// Sales by store (spec US3, FR-008): rows with both profit figures, the same sales total as the summary, sorting,
// search, paging, and only stores that sold something in the period.

let db: PGlite;
let t: Tenant;
let madina: string;
let noor: string;
let zam: string;
let cancelledOnly: string;

const PERIOD: [string, string] = ["2026-02-01", "2026-02-28"];

beforeAll(async () => {
  db = await createTestDb();
  t = await createTenant(db, "bystore");
  madina = await insertStore(db, t.businessId, "Al Madina Pharmacy");
  noor = await insertStore(db, t.businessId, "Noor Medical");
  zam = await insertStore(db, t.businessId, "Zam Zam Chemist");
  cancelledOnly = await insertStore(db, t.businessId, "Cancelled Store");
  const p = await seedMedicine(db, t.businessId, { name: "Panadol" });
  const q = await seedMedicine(db, t.businessId, { name: "Brufen" });
  await seedPurchase(db, t.userId, { product: p, date: "2026-02-03", qty: 100, unitCost: "10.00" });
  // Madina: 100.00 + 300.00, costed (profit 50 + 200). Noor: 500.00 with no cost known. Zam: 100.00 at a loss (cost 10 each).
  await seedIssuedInvoice(db, t, { storeId: madina, date: "2026-02-03", lines: [{ product: p, qty: 5, price: "20.00", purchase: "10.00" }] });
  await seedIssuedInvoice(db, t, { storeId: madina, date: "2026-02-03", lines: [{ product: p, qty: 10, price: "30.00", purchase: "10.00" }] });
  await seedIssuedInvoice(db, t, { storeId: noor, date: "2026-02-10", lines: [{ product: q, qty: 5, price: "100.00" }] });
  await seedIssuedInvoice(db, t, { storeId: zam, date: "2026-02-03", lines: [{ product: p, qty: 10, price: "8.00", purchase: "10.00" }] });
  await seedIssuedInvoice(db, t, { storeId: cancelledOnly, date: "2026-02-04", lines: [{ product: p, qty: 1, price: "99.00" }], status: "cancelled" });
}, 120_000);

afterAll(async () => {
  await db.close();
});

type Item = { store_id: string; name: string; sales: string; invoices: number; share: string; estimated: { profit: string | null; status: string }; realized: { profit: string | null; status: string } };

describe("sales by store", () => {
  it("lists the stores that sold something, with sales, invoices, share and both figures with their labels", async () => {
    const r = await dbReportByStore(db, t.userId, { from: PERIOD[0], to: PERIOD[1] });
    const items = r.items as Item[];
    expect(items.map((i) => i.name)).toEqual(["Noor Medical", "Al Madina Pharmacy", "Zam Zam Chemist"]); // by sales, largest first; the cancelled-only store is not listed
    const madinaRow = items.find((i) => i.name === "Al Madina Pharmacy")!;
    expect(madinaRow).toMatchObject({ sales: "400.00", invoices: 2, share: "40.8" }); // 400 of 980
    expect(madinaRow.realized).toMatchObject({ profit: "250.00", status: "complete" }); // (100 + 300) - 15 units x 10.00
    expect(madinaRow.estimated).toMatchObject({ profit: "250.00", status: "complete" });
    const noorRow = items.find((i) => i.name === "Noor Medical")!;
    expect(noorRow).toMatchObject({ sales: "500.00", share: "51.0" });
    expect(noorRow.realized).toMatchObject({ profit: null, status: "incomplete" });
    expect(noorRow.estimated).toMatchObject({ profit: null, status: "incomplete" });
    const zamRow = items.find((i) => i.name === "Zam Zam Chemist")!;
    expect(zamRow).toMatchObject({ sales: "80.00", share: "8.2" });
    expect(zamRow.realized.profit).toBe("-20.00");
    expect(r.total).toBe(3);
  });

  it("adds up to the summary's sales total (and the filtered totals equal the whole when nothing is filtered)", async () => {
    const summary = await dbReportSales(db, t.userId, PERIOD[0], PERIOD[1]);
    const r = await dbReportByStore(db, t.userId, { from: PERIOD[0], to: PERIOD[1] });
    const cents = (r.items as Item[]).reduce((a, i) => a + Math.round(Number(i.sales) * 100), 0);
    expect(cents).toBe(Math.round(Number(summary.totals.sales) * 100));
    expect(r.totals.sales).toBe(summary.totals.sales);
    expect(r.totals.invoices).toBe(summary.totals.invoices);
    expect(r.totals.realized).toEqual(summary.realized);
    expect(r.totals.estimated).toEqual(summary.estimated);
    expect(r.filtered_totals).toEqual(r.totals);
  });

  it("sorts by sales, by realized profit (unknown last) and by name", async () => {
    const names = async (sort: "sales" | "profit" | "name") =>
      ((await dbReportByStore(db, t.userId, { from: PERIOD[0], to: PERIOD[1], sort })).items as Item[]).map((i) => i.name);
    expect(await names("sales")).toEqual(["Noor Medical", "Al Madina Pharmacy", "Zam Zam Chemist"]);
    // Realized profit: Madina 250, Zam -20, Noor not available (last).
    expect(await names("profit")).toEqual(["Al Madina Pharmacy", "Zam Zam Chemist", "Noor Medical"]);
    expect(await names("name")).toEqual(["Al Madina Pharmacy", "Noor Medical", "Zam Zam Chemist"]);
  });

  it("narrows the rows with a search while totals keep the whole period and filtered totals cover the matches", async () => {
    const r = await dbReportByStore(db, t.userId, { from: PERIOD[0], to: PERIOD[1], q: "medical" });
    expect((r.items as Item[]).map((i) => i.name)).toEqual(["Noor Medical"]);
    expect(r.total).toBe(1);
    expect(r.totals.sales).toBe("980.00");
    expect(r.filtered_totals.sales).toBe("500.00");
    expect(r.filtered_totals.invoices).toBe(1);
    // A percent sign or underscore typed in the box is literal text, not a wildcard.
    expect((await dbReportByStore(db, t.userId, { from: PERIOD[0], to: PERIOD[1], q: "%" })).items).toEqual([]);
    expect((await dbReportByStore(db, t.userId, { from: PERIOD[0], to: PERIOD[1], q: "al med" })).items).toHaveLength(1);
  });

  it("pages the rows and accepts a large page for the export", async () => {
    const first = await dbReportByStore(db, t.userId, { from: PERIOD[0], to: PERIOD[1], limit: 2, offset: 0 });
    const second = await dbReportByStore(db, t.userId, { from: PERIOD[0], to: PERIOD[1], limit: 2, offset: 2 });
    expect((first.items as Item[]).map((i) => i.name)).toEqual(["Noor Medical", "Al Madina Pharmacy"]);
    expect((second.items as Item[]).map((i) => i.name)).toEqual(["Zam Zam Chemist"]);
    expect(first.total).toBe(3);
    const big = await dbReportByStore(db, t.userId, { from: PERIOD[0], to: PERIOD[1], limit: 5000 });
    expect(big.items).toHaveLength(3);
  });

  it("returns an empty list (with zero totals) for a period without sales, and refuses a bad sort or period", async () => {
    const r = await dbReportByStore(db, t.userId, { from: "2025-01-01", to: "2025-01-31" });
    expect(r).toMatchObject({ items: [], total: 0, totals: { sales: "0.00", invoices: 0 } });
    await expect(dbReportByStore(db, t.userId, { from: PERIOD[0], to: PERIOD[1], sort: "cost" as "sales" })).rejects.toThrow(/invalid_sort/);
    await expect(dbReportByStore(db, t.userId, { from: PERIOD[1], to: PERIOD[0] })).rejects.toThrow(/invalid_period/);
  });

  it("never lists another business's stores", async () => {
    const other = await createTenant(db, "bystore-other");
    const r = await dbReportByStore(db, other.userId, { from: PERIOD[0], to: PERIOD[1] });
    expect(r.items).toEqual([]);
    expect(r.totals.sales).toBe("0.00");
  });
});
