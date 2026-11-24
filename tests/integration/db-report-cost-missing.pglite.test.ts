import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import {
  dbReportCostMissing,
  insertRawInvoice,
  insertStore,
  seedBareOrder,
  seedIssuedInvoice,
  seedMedicine,
  seedPurchase,
} from "../helpers/reports-db";

// The Cost missing list (spec FR-014): one row per medicine and unit with the sales amount concerned, which figure is
// missing, the market days without a cost and a reason.

let db: PGlite;
let t: Tenant;
let store: string;
let bothMissing: string;
let estimateOnly: string;
let realizedOnly: string;
let covered: string;
let otherUnit: string;

beforeAll(async () => {
  db = await createTestDb();
  t = await createTenant(db, "costmissing");
  store = await insertStore(db, t.businessId, "S");
  bothMissing = await seedMedicine(db, t.businessId, { name: "Zinc", strength: "20 mg" });
  estimateOnly = await seedMedicine(db, t.businessId, { name: "Brufen", strength: "400 mg", dosage_form: "tablet", pack_size: "20", manufacturer: "Abbott" });
  realizedOnly = await seedMedicine(db, t.businessId, { name: "Calpol" });
  covered = await seedMedicine(db, t.businessId, { name: "Covered" });
  otherUnit = await seedMedicine(db, t.businessId, { name: "Bought by the box", unit: "strip" });

  // Day 1 (2026-05-04): every medicine is sold once.
  await seedPurchase(db, t.userId, { product: estimateOnly, date: "2026-05-04", qty: 10, unitCost: "30.00" }); // has a realized cost, no saved price
  await seedPurchase(db, t.userId, { product: covered, date: "2026-05-04", qty: 10, unitCost: "10.00" });
  await seedPurchase(db, t.userId, { product: otherUnit, date: "2026-05-04", unit: "box", qty: 5, unitCost: "300.00" });
  await seedIssuedInvoice(db, t, {
    storeId: store,
    date: "2026-05-04",
    lines: [
      { product: bothMissing, qty: 2, price: "100.00", purchase: null },
      { product: estimateOnly, qty: 3, price: "50.00", purchase: null },
      { product: realizedOnly, qty: 4, price: "25.00", purchase: "15.00" },
      { product: covered, qty: 1, price: "20.00", purchase: "10.00" },
      { product: otherUnit, qty: 2, price: "40.00", purchase: "25.00" },
    ],
  });
  // Day 2 (2026-05-05): Zinc again, and Calpol again; neither has a purchase that day.
  await seedIssuedInvoice(db, t, {
    storeId: store,
    date: "2026-05-05",
    lines: [
      { product: bothMissing, qty: 1, price: "100.00", purchase: null },
      { product: realizedOnly, qty: 1, price: "25.00", purchase: "15.00" },
    ],
  });
}, 90_000);

afterAll(async () => {
  await db.close();
});

type Row = { name: string; unit: string; product_id: string | null; sales_amount: string; billed_quantity: number; lines: number; estimate_missing: boolean; realized_missing: boolean; realized_dates: string[]; reason: string; strength: string | null; manufacturer: string | null };

describe("cost missing", () => {
  it("lists a medicine with no cost for a figure, once per unit, with the sales amount, quantity and line count", async () => {
    const r = await dbReportCostMissing(db, t.userId, "2026-05-04", "2026-05-05");
    const byName = Object.fromEntries((r.items as Row[]).map((x) => [x.name, x]));
    expect(byName["Zinc"]).toMatchObject({ sales_amount: "300.00", billed_quantity: 3, lines: 2, estimate_missing: true, realized_missing: true });
    expect(byName["Zinc"].realized_dates.map(String)).toEqual(["2026-05-04", "2026-05-05"]);
    expect(byName["Calpol"]).toMatchObject({ sales_amount: "125.00", billed_quantity: 5, lines: 2, estimate_missing: false, realized_missing: true });
    expect(byName["Brufen"]).toMatchObject({ sales_amount: "150.00", estimate_missing: true, realized_missing: false, realized_dates: [] });
    expect(byName["Brufen"]).toMatchObject({ strength: "400 mg", manufacturer: "Abbott" });
  });

  it("does not list a medicine that has a cost for both figures on every day", async () => {
    const r = await dbReportCostMissing(db, t.userId, "2026-05-04", "2026-05-05");
    expect((r.items as Row[]).map((x) => x.name)).not.toContain("Covered");
  });

  it("gives the right reason: not registered, unit differs, no purchase that day, or no saved price", async () => {
    const r = await dbReportCostMissing(db, t.userId, "2026-05-04", "2026-05-05");
    const byName = Object.fromEntries((r.items as Row[]).map((x) => [x.name, x]));
    expect(byName["Zinc"].reason).toBe("no_purchase_on_market_day");
    expect(byName["Calpol"].reason).toBe("no_purchase_on_market_day");
    expect(byName["Brufen"].reason).toBe("no_purchase_price_saved");
    expect(byName["Bought by the box"].reason).toBe("unit_differs");
  });

  it("sorts by sales amount (largest first), then name", async () => {
    const r = await dbReportCostMissing(db, t.userId, "2026-05-04", "2026-05-05");
    const amounts = (r.items as Row[]).map((x) => Number(x.sales_amount));
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    expect(r.total).toBe(r.items.length);
    expect(r.truncated).toBe(false);
  });

  it("lists a billed typed line as typed_line, by its typed text, with no product id", async () => {
    const tenant = await createTenant(db, "typedmissing");
    const s = await insertStore(db, tenant.businessId, "S");
    const p = await seedMedicine(db, tenant.businessId, { name: "Parent" });
    const { orderId } = await seedBareOrder(db, tenant, s, p, "2026-05-06");
    await insertRawInvoice(db, tenant, { orderId, storeId: s, date: "2026-05-06", lines: [{ productId: null, name: "Noran 20mg cap", qty: 2, price: "30.00" }] });
    const r = await dbReportCostMissing(db, tenant.userId, "2026-05-06", "2026-05-06");
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ product_id: null, name: "Noran 20mg cap", reason: "typed_line", sales_amount: "60.00", estimate_missing: true, realized_missing: true });
  });

  it("returns an empty list for a period where every cost is known, and nothing from another business", async () => {
    const empty = await dbReportCostMissing(db, t.userId, "2026-04-01", "2026-04-30");
    expect(empty).toMatchObject({ total: 0, items: [], truncated: false });
    const other = await createTenant(db, "othermissing");
    const mine = await dbReportCostMissing(db, other.userId, "2026-05-04", "2026-05-05");
    expect(mine.items).toEqual([]);
  });
});
