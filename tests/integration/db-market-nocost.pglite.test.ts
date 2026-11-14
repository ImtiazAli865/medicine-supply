import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toCsv } from "../../src/lib/market/csv";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import { catalogLine, typedLine } from "../helpers/orders";
import { insertMedicine, insertStore } from "../helpers/pending-db";
import { allKeys, dbMarketList, dbMarketSummary, dbRecord, moneyKeys, pkt, seedConfirmedOrder } from "../helpers/market-db";

// The list, its summary and the CSV built from it never carry a price or a cost, even when the medicines have
// purchase prices, selling prices and MRPs and the purchases have actual unit costs (FR-007, FR-018, SC-008).

const DAY = "2026-11-12";
const SECRET_VALUES = ["90.00", "125.50", "130.00", "88.75", "91.23", "Secret Wholesaler", "INV-SECRET"];

let db: PGlite;
let t: Tenant;

beforeAll(async () => {
  db = await createTestDb();
  t = await createTenant(db, "nocost");
  const store = await insertStore(db, t.businessId, "Al Madina");
  const panadol = await insertMedicine(db, t.businessId, {
    name: "Panadol",
    unit: "strip",
    purchase_price: "90.00",
    selling_price: "125.50",
    mrp: "130.00",
  });
  await seedConfirmedOrder(db, t.userId, store, [catalogLine(panadol, 20), typedLine("Noran 20mg cap", 5)], pkt(DAY, "10:00"));
  await dbRecord(db, t.userId, { product: panadol, date: DAY, quantity: 8, unit_cost: "88.75", supplier: "Secret Wholesaler", reference: "INV-SECRET" });
  await dbRecord(db, t.userId, { product: panadol, date: DAY, quantity: 2, unit_cost: "91.23" });
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("no price, cost, MRP, margin or profit anywhere on the list", () => {
  it("has no such key at any depth in the list and the summary", async () => {
    const list = await dbMarketList(db, t.userId, { date: DAY });
    const summary = await dbMarketSummary(db, t.userId, DAY);
    expect(list.rows[0].purchased).toBe(10); // the purchases are counted ...
    expect(moneyKeys(list)).toEqual([]); // ... but none of their details is on the list
    expect(moneyKeys(summary)).toEqual([]);
    expect([...allKeys(list)].sort()).toEqual(
      [
        "business_name", "can_record", "date", "dosage_form", "extra", "generated_at", "id", "key", "manufacturer", "name",
        "pack_size", "product_id", "purchased", "quantity", "remaining", "rows", "shown_requested", "status", "store_id",
        "store_name", "stores", "strength", "total_requested", "totals", "truncated", "typed_name", "typed_rows", "unit",
        "requested", "name",
      ].filter((v, i, a) => a.indexOf(v) === i).sort(),
    );
  });

  it("carries no price, cost, supplier or reference value in the list text", async () => {
    const text = JSON.stringify([await dbMarketList(db, t.userId, { date: DAY }), await dbMarketSummary(db, t.userId, DAY)]);
    for (const value of SECRET_VALUES) expect(text, value).not.toContain(value);
  });

  it("carries none in the CSV built from the list", async () => {
    const csv = toCsv(await dbMarketList(db, t.userId, { date: DAY }));
    for (const value of SECRET_VALUES) expect(csv, value).not.toContain(value);
    expect(csv.split("\r\n")[0]).not.toMatch(/price|cost|mrp|margin|profit/i);
    expect(csv).toContain("Panadol");
    expect(csv).toContain("unregistered");
  });
});
