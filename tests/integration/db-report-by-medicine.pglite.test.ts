import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import {
  dbReportByMedicine,
  dbReportByStore,
  dbReportSales,
  insertRawInvoice,
  insertStore,
  seedBareOrder,
  seedIssuedInvoice,
  seedMedicine,
  seedPurchase,
} from "../helpers/reports-db";

// Sales by medicine (spec US3, FR-007, FR-008): medicines that differ in strength, form, pack size or manufacturer are
// separate rows, the same medicine in two units is two rows, typed lines are in their own group, and every list adds
// up to the summary's sales.

let db: PGlite;
let t: Tenant;
let store: string;
const PERIOD: [string, string] = ["2026-01-05", "2026-01-25"];

type Item = { key: string; product_id: string | null; name: string; typed_name: string | null; strength: string | null; dosage_form: string | null; pack_size: string | null; manufacturer: string | null; unit: string; billed_quantity: number; sales: string; realized: { profit: string | null; status: string }; estimated: { profit: string | null } };

beforeAll(async () => {
  db = await createTestDb();
  t = await createTenant(db, "bymedicine");
  store = await insertStore(db, t.businessId, "Al Madina");
  const p250 = await seedMedicine(db, t.businessId, { name: "Panadol", strength: "250 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK" });
  const p500 = await seedMedicine(db, t.businessId, { name: "Panadol", strength: "500 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK" });
  const p500Pack = await seedMedicine(db, t.businessId, { name: "Panadol", strength: "500 mg", dosage_form: "tablet", pack_size: "20", manufacturer: "GSK" });
  const p500Maker = await seedMedicine(db, t.businessId, { name: "Panadol", strength: "500 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "Other Pharma" });
  const brufen = await seedMedicine(db, t.businessId, { name: "Brufen", strength: "400 mg" });
  const retired = await seedMedicine(db, t.businessId, { name: "Old Syrup" });
  await seedPurchase(db, t.userId, { product: p500, date: "2026-01-06", qty: 100, unitCost: "40.00" });
  await seedPurchase(db, t.userId, { product: brufen, date: "2026-01-06", qty: 100, unitCost: "60.00" });
  await seedIssuedInvoice(db, t, {
    storeId: store,
    date: "2026-01-06",
    lines: [
      { product: p250, qty: 1, price: "30.00" },
      { product: p500, qty: 2, price: "50.00", purchase: "40.00" },
      { product: p500Pack, qty: 3, price: "90.00" },
      { product: p500Maker, qty: 4, price: "45.00" },
      { product: brufen, qty: 5, price: "70.00", purchase: "60.00" },
      { product: retired, qty: 1, price: "15.00" },
    ],
  });
  // The same Panadol 500 mg sold in two units.
  await seedIssuedInvoice(db, t, { storeId: store, date: "2026-01-07", lines: [{ product: p500, unit: "box", qty: 1, price: "480.00" }] });
  // Sold again on another day, in the strip unit: joins the first Panadol 500 mg row.
  await seedIssuedInvoice(db, t, { storeId: store, date: "2026-01-08", lines: [{ product: p500, qty: 1, price: "50.00", purchase: "40.00" }] });
  // The medicine is made inactive and renamed afterwards: the report keeps the name frozen on the invoice line.
  await db.query(`update public.products set is_active = false, name = 'Renamed later' where id = $1`, [retired]);
  // Two billed typed lines whose texts differ only by capitals and spaces are one group.
  const { orderId } = await seedBareOrder(db, t, store, brufen, "2026-01-09");
  await insertRawInvoice(db, t, {
    orderId,
    storeId: store,
    date: "2026-01-09",
    lines: [
      { productId: null, name: "Noran 20mg cap", qty: 2, price: "40.00" },
      { productId: null, name: "  NORAN   20mg CAP ", qty: 1, price: "40.00" },
    ],
  });
}, 150_000);

afterAll(async () => {
  await db.close();
});

describe("sales by medicine", () => {
  it("keeps different strengths, pack sizes and manufacturers as separate rows, and the same medicine in two units as two rows", async () => {
    const r = await dbReportByMedicine(db, t.userId, { from: PERIOD[0], to: PERIOD[1], limit: 50 });
    const panadol = (r.items as Item[]).filter((i) => i.name === "Panadol");
    expect(panadol).toHaveLength(5); // 250 mg; 500 mg strip; 500 mg box; 500 mg pack 20; 500 mg other maker
    const keys = new Set(panadol.map((i) => i.key));
    expect(keys.size).toBe(5);
    expect(panadol.map((i) => `${i.strength}|${i.pack_size}|${i.manufacturer}|${i.unit}`).sort()).toEqual([
      "250 mg|10|GSK|strip",
      "500 mg|10|GSK|box",
      "500 mg|10|GSK|strip",
      "500 mg|10|Other Pharma|strip",
      "500 mg|20|GSK|strip",
    ]);
    const strip = panadol.find((i) => i.strength === "500 mg" && i.pack_size === "10" && i.manufacturer === "GSK" && i.unit === "strip")!;
    expect(strip).toMatchObject({ billed_quantity: 3, sales: "150.00" });
    // The 8 Jan line has no purchase on its own market day (the only purchase was on 6 Jan), so the realized figure covers
    // the two units of 6 Jan only (100.00 - 2 x 40.00 = 20.00) and says it is incomplete; the estimate knows all three.
    expect(strip.realized).toMatchObject({ profit: "20.00", status: "incomplete", missing_lines: 1, missing_sales: "50.00" });
    expect(strip.estimated).toMatchObject({ profit: "30.00", status: "complete" });
  });

  it("shows a medicine that is now inactive or renamed with the name frozen on its invoice line", async () => {
    const r = await dbReportByMedicine(db, t.userId, { from: PERIOD[0], to: PERIOD[1], limit: 50 });
    expect((r.items as Item[]).map((i) => i.name)).toContain("Old Syrup");
    expect((r.items as Item[]).map((i) => i.name)).not.toContain("Renamed later");
  });

  it("puts typed lines in their own group by exact typed text (capitals and repeated spaces ignored) with the sales kept", async () => {
    const r = await dbReportByMedicine(db, t.userId, { from: PERIOD[0], to: PERIOD[1], limit: 50 });
    expect(r.typed_rows).toHaveLength(1);
    expect(r.typed_rows[0]).toMatchObject({ product_id: null, typed_name: expect.stringMatching(/noran/i), billed_quantity: 3, sales: "120.00" });
    expect(r.typed_rows[0].realized).toMatchObject({ profit: null, status: "incomplete" });
    expect((r.items as Item[]).every((i) => i.product_id !== null)).toBe(true);
  });

  it("adds up, with the typed group, to the summary's sales and to the store rows' sales", async () => {
    const summary = await dbReportSales(db, t.userId, PERIOD[0], PERIOD[1]);
    const r = await dbReportByMedicine(db, t.userId, { from: PERIOD[0], to: PERIOD[1], limit: 50 });
    const cents = (rows: Array<{ sales: string }>) => rows.reduce((a, i) => a + Math.round(Number(i.sales) * 100), 0);
    expect(cents(r.items) + cents(r.typed_rows)).toBe(Math.round(Number(summary.totals.sales) * 100));
    expect(r.totals.sales).toBe(summary.totals.sales);
    expect(r.totals.realized).toEqual(summary.realized);
    const stores = await dbReportByStore(db, t.userId, { from: PERIOD[0], to: PERIOD[1] });
    expect(stores.totals.sales).toBe(summary.totals.sales);
  });

  it("sorts by sales, by realized profit (unknown last) and by name", async () => {
    const rows = async (sort: "sales" | "profit" | "name") =>
      ((await dbReportByMedicine(db, t.userId, { from: PERIOD[0], to: PERIOD[1], sort, limit: 50 })).items as Item[]).map((i) => `${i.name} ${i.strength ?? ""} ${i.unit}`.trim());
    const bySales = await rows("sales");
    expect(bySales[0]).toBe("Panadol 500 mg box"); // 480.00
    const byProfit = (await dbReportByMedicine(db, t.userId, { from: PERIOD[0], to: PERIOD[1], sort: "profit", limit: 50 })).items as Item[];
    const profits = byProfit.map((i) => i.realized.profit);
    // Known profits first (largest first), then every row whose realized profit is not available.
    const firstUnknown = profits.findIndex((p) => p === null);
    expect(firstUnknown).toBeGreaterThan(0);
    expect(profits.slice(firstUnknown).every((p) => p === null)).toBe(true);
    const known = profits.slice(0, firstUnknown).map(Number);
    expect(known).toEqual([...known].sort((a, b) => b - a));
    const names = ((await dbReportByMedicine(db, t.userId, { from: PERIOD[0], to: PERIOD[1], sort: "name", limit: 50 })).items as Item[]).map((i) => i.name.toLowerCase());
    expect(names).toEqual([...names].sort());
  });

  it("searches name, strength, form, pack size and manufacturer; totals keep the whole period", async () => {
    const r = await dbReportByMedicine(db, t.userId, { from: PERIOD[0], to: PERIOD[1], q: "panadol 250", limit: 50 });
    expect((r.items as Item[]).map((i) => i.strength)).toEqual(["250 mg"]);
    expect(r.total).toBe(1);
    expect(r.filtered_totals.sales).toBe("30.00");
    expect(r.totals.sales).not.toBe("30.00");
    const maker = await dbReportByMedicine(db, t.userId, { from: PERIOD[0], to: PERIOD[1], q: "other pharma", limit: 50 });
    expect((maker.items as Item[]).map((i) => i.manufacturer)).toEqual(["Other Pharma"]);
  });

  it("pages the rows", async () => {
    const all = (await dbReportByMedicine(db, t.userId, { from: PERIOD[0], to: PERIOD[1], limit: 50 })).items as Item[];
    const a = (await dbReportByMedicine(db, t.userId, { from: PERIOD[0], to: PERIOD[1], limit: 3, offset: 0 })).items as Item[];
    const b = (await dbReportByMedicine(db, t.userId, { from: PERIOD[0], to: PERIOD[1], limit: 3, offset: 3 })).items as Item[];
    expect([...a, ...b].map((i) => i.key)).toEqual(all.slice(0, 6).map((i) => i.key));
  });

  it("returns nothing for another business and refuses a bad sort", async () => {
    const other = await createTenant(db, "bymedicine-other");
    const r = await dbReportByMedicine(db, other.userId, { from: PERIOD[0], to: PERIOD[1] });
    expect(r).toMatchObject({ items: [], typed_rows: [], total: 0 });
    await expect(dbReportByMedicine(db, t.userId, { from: PERIOD[0], to: PERIOD[1], sort: "x" as "sales" })).rejects.toThrow(/invalid_sort/);
  });
});
