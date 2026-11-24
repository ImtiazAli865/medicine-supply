import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbAccount, dbStatement, dbStores, dbSummary } from "../helpers/accounts-db";
import { dbInvoiceGet, dbInvoiceList, dbOrderSheet, dbOrderSheetDay } from "../helpers/invoices-db";
import { dbMarketList, dbMarketSummary } from "../helpers/market-db";
import { dbGet } from "../helpers/orders-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import { dbReportSales, insertStore, seedIssuedInvoice, seedMedicine, seedPurchase, type Json } from "../helpers/reports-db";

// Reports are the only place a cost or a profit may appear (spec FR-018, SC-006). With real costs, saved purchase prices
// and a profit in the data, every other response of the app stays free of them. The existing no-cost tests of each module
// keep running unchanged; this one checks them together once the reports exist. The reports' own response is checked too:
// it DOES carry the cost (so the check can tell a leak from an empty answer).

const DAY = "2026-11-22";
// Values that appear nowhere by accident.
const ACTUAL_COST = "41.37";
const SAVED_PRICE = "43.21";
const CATALOG_COST = "44.44";
const SECRET_VALUES = [ACTUAL_COST, SAVED_PRICE, CATALOG_COST, "41.3700", "43.2100"];
const FORBIDDEN_KEY = /purchase_price|unit_cost|\bcost\b|\bmargin\b|\bprofit\b|\bmrp\b|real_cost|est_cost|covered_sales/i;

let db: PGlite;
let t: Tenant;
let store: string;
let seeded: { orderId: string; invoiceId: string };

function keys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keys(v, into));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      keys(v, into);
    }
  }
  return into;
}

beforeAll(async () => {
  db = await createTestDb();
  t = await createTenant(db, "internalonly");
  store = await insertStore(db, t.businessId, "Al Madina");
  const product = await seedMedicine(db, t.businessId, { name: "Panadol", strength: "500 mg", purchase_price: CATALOG_COST, selling_price: "77.77" });
  await seedPurchase(db, t.userId, { product, date: DAY, qty: 20, unitCost: ACTUAL_COST });
  seeded = await seedIssuedInvoice(db, t, { storeId: store, date: DAY, lines: [{ product, qty: 5, price: "77.77", purchase: SAVED_PRICE }] });
}, 90_000);

afterAll(async () => {
  await db.close();
});

describe("the reports carry the cost (so the checks below mean something)", () => {
  it("shows the cost and the profit", async () => {
    const r = await dbReportSales(db, t.userId, DAY, DAY);
    const text = JSON.stringify(r);
    expect(text).toContain("206.85"); // 5 x 41.37
    expect(text).toContain("profit");
  });
});

describe("no other response carries a cost, a purchase price or a profit", () => {
  async function responses(): Promise<Array<[string, Json]>> {
    return [
      ["invoice", await dbInvoiceGet(db, t.userId, seeded.invoiceId)],
      ["invoice list", await dbInvoiceList(db, t.userId, {})],
      ["order", await dbGet(db, t.userId, seeded.orderId)],
      ["order sheet", await dbOrderSheet(db, t.userId, [seeded.orderId])],
      ["order sheet of the day", await dbOrderSheetDay(db, t.userId, DAY)],
      ["market list", await dbMarketList(db, t.userId, { date: DAY })],
      ["market summary", await dbMarketSummary(db, t.userId, DAY)],
      ["account", await dbAccount(db, t.userId, store)],
      ["statement", await dbStatement(db, t.userId, store, "2026-11-01", "2026-11-30")],
      ["stores with balances", await dbStores(db, t.userId)],
      ["accounts summary", await dbSummary(db, t.userId)],
    ];
  }

  it("has no cost, margin, profit or purchase-price key in any of them", async () => {
    for (const [name, value] of await responses()) {
      const bad = [...keys(value)].filter((k) => FORBIDDEN_KEY.test(k));
      expect(bad, `${name} must not carry ${bad.join(", ")}`).toEqual([]);
    }
  });

  it("has none of the cost values in any of them", async () => {
    for (const [name, value] of await responses()) {
      const text = JSON.stringify(value);
      for (const secret of SECRET_VALUES) expect(text, `${name} must not contain ${secret}`).not.toContain(secret);
    }
  });
});
