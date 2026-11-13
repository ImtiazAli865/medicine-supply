import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import { catalogLine, typedLine } from "../helpers/orders";
import { insertMedicine, insertStore } from "../helpers/pending-db";
import { addDays, dbMarketList, moneyKeys, pkt, seedConfirmedOrder, seedDraftOrder } from "../helpers/market-db";
import { dbCancel } from "../helpers/orders-db";
import type { MarketRow } from "../../src/lib/market/types";

// The market list of a Pakistan day (migration 0006): what it counts, how it groups, and what it never shows.
// A fixed day is used so the tests never depend on today's date.

const DAY = "2026-11-12";
const at = (time = "10:00", day = DAY) => pkt(day, time);

let db: PGlite;
let counter = 0;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  await db.close();
});

/** A fresh business with the given stores, so tests never see each other's orders. */
async function fresh(storeNames: string[] = ["Al Madina"]) {
  counter += 1;
  const t: Tenant = await createTenant(db, `list${counter}`);
  const stores: Record<string, string> = {};
  for (const name of storeNames) stores[name] = await insertStore(db, t.businessId, name);
  return { t, stores };
}

const byName = (rows: MarketRow[], name: string) => rows.filter((r) => r.name === name);
const storeMap = (row: MarketRow) => Object.fromEntries(row.stores.map((s) => [s.store_name, s.quantity]));

describe("the master prompt example and the sum rule", () => {
  it("adds Panadol 20 + 10 + 15 to 45 and lists each store with its own quantity", async () => {
    const { t, stores } = await fresh(["Al Madina", "Shah Medical", "Rehman Medical"]);
    const panadol = await insertMedicine(db, t.businessId, { name: "Panadol", unit: "strip", strength: "500 mg", dosage_form: "tablet" });
    await seedConfirmedOrder(db, t.userId, stores["Al Madina"], [catalogLine(panadol, 20, "strip")], at());
    await seedConfirmedOrder(db, t.userId, stores["Shah Medical"], [catalogLine(panadol, 10, "strip")], at("11:00"));
    await seedConfirmedOrder(db, t.userId, stores["Rehman Medical"], [catalogLine(panadol, 15, "strip")], at("12:00"));

    const list = await dbMarketList(db, t.userId, { date: DAY });
    expect(list.rows).toHaveLength(1);
    const row = list.rows[0];
    expect(row).toMatchObject({ name: "Panadol", unit: "strip", total_requested: 45, purchased: 0, remaining: 45, extra: 0, status: "not_bought", can_record: true });
    expect(storeMap(row)).toEqual({ "Al Madina": 20, "Shah Medical": 10, "Rehman Medical": 15 });
    // The stores of one row are ordered by name.
    expect(row.stores.map((s) => s.store_name)).toEqual(["Al Madina", "Rehman Medical", "Shah Medical"]);
  });

  it("makes the sum of all list quantities equal the sum of the confirmed order line quantities, typed lines included", async () => {
    const { t, stores } = await fresh(["Al Madina", "Shah Medical"]);
    const panadol = await insertMedicine(db, t.businessId, { name: "Panadol" });
    const brufen = await insertMedicine(db, t.businessId, { name: "Brufen", unit: "box" });
    await seedConfirmedOrder(db, t.userId, stores["Al Madina"], [catalogLine(panadol, 20), catalogLine(brufen, 7, "box"), typedLine("Noran 20mg cap", 4)], at());
    await seedConfirmedOrder(db, t.userId, stores["Shah Medical"], [catalogLine(panadol, 10), typedLine("noran 20mg CAP", 6)], at("13:00"));
    const confirmedTotal = 20 + 7 + 4 + 10 + 6; // known from what was seeded

    const list = await dbMarketList(db, t.userId, { date: DAY });
    const listed = [...list.rows, ...list.typed_rows].reduce((sum, r) => sum + r.total_requested, 0);
    expect(listed).toBe(confirmedTotal);
    expect(list.totals).toMatchObject({ requested: confirmedTotal, rows: 2, typed_rows: 1 });
  });

  it("never counts draft or cancelled orders and counts a fulfilled order", async () => {
    const { t, stores } = await fresh(["Al Madina", "Shah Medical", "Rehman Medical", "Noor Pharmacy"]);
    const panadol = await insertMedicine(db, t.businessId, { name: "Panadol" });
    const brufen = await insertMedicine(db, t.businessId, { name: "Brufen" });
    await seedConfirmedOrder(db, t.userId, stores["Al Madina"], [catalogLine(panadol, 20)], at());
    await seedDraftOrder(db, t.userId, stores["Shah Medical"], [catalogLine(panadol, 99), catalogLine(brufen, 5)]);
    const toCancel = await seedConfirmedOrder(db, t.userId, stores["Rehman Medical"], [catalogLine(panadol, 50), catalogLine(brufen, 8)], at("11:00"));
    const cancelled = await dbCancel(db, t.userId, toCancel.id, toCancel.order.version, "Store cancelled");
    expect(cancelled.cancelled).toBe(true);
    // A fulfilled order is reachable only from later modules: change its status as the table owner, with the guard paused.
    const fulfilled = await seedConfirmedOrder(db, t.userId, stores["Noor Pharmacy"], [catalogLine(panadol, 3)], at("12:00"));
    await db.exec(`alter table public.orders disable trigger orders_guard`);
    await db.query(`update public.orders set status = 'fulfilled' where id = $1`, [fulfilled.id]);
    await db.exec(`alter table public.orders enable trigger orders_guard`);

    const list = await dbMarketList(db, t.userId, { date: DAY });
    expect(byName(list.rows, "Panadol")[0].total_requested).toBe(23); // 20 confirmed + 3 fulfilled
    expect(byName(list.rows, "Brufen")).toHaveLength(0); // only on a draft and a cancelled order
    expect(list.totals.requested).toBe(23);
  });
});

describe("the Pakistan day", () => {
  it("puts 23:59 on the day and 00:00 on the next day, whatever the UTC date is", async () => {
    const { t, stores } = await fresh(["Al Madina", "Shah Medical", "Noor Pharmacy"]);
    const panadol = await insertMedicine(db, t.businessId, { name: "Panadol" });
    await seedConfirmedOrder(db, t.userId, stores["Al Madina"], [catalogLine(panadol, 1)], at("23:59"));
    await seedConfirmedOrder(db, t.userId, stores["Shah Medical"], [catalogLine(panadol, 2)], pkt(addDays(DAY, 1), "00:00"));
    // 02:00 PKT is 21:00 UTC of the day before: the PKT day wins.
    await seedConfirmedOrder(db, t.userId, stores["Noor Pharmacy"], [catalogLine(panadol, 4)], at("02:00"));

    const thisDay = await dbMarketList(db, t.userId, { date: DAY });
    const nextDay = await dbMarketList(db, t.userId, { date: addDays(DAY, 1) });
    expect(thisDay.rows[0].total_requested).toBe(5); // 1 (23:59) + 4 (02:00)
    expect(nextDay.rows[0].total_requested).toBe(2);
    expect(storeMap(nextDay.rows[0])).toEqual({ "Shah Medical": 2 });
  });

  it("returns an empty list for a day with no confirmed orders", async () => {
    const { t } = await fresh();
    const list = await dbMarketList(db, t.userId, { date: DAY });
    expect(list).toMatchObject({ rows: [], typed_rows: [], stores: [], truncated: false });
    expect(list.totals).toEqual({ requested: 0, purchased: 0, remaining: 0, rows: 0, typed_rows: 0 });
  });
});

describe("grouping", () => {
  it("keeps a different strength, dosage form, manufacturer or pack size as its own row", async () => {
    const { t, stores } = await fresh(["Al Madina"]);
    const base = { name: "Panadol", unit: "strip" };
    const a = await insertMedicine(db, t.businessId, { ...base, strength: "500 mg", dosage_form: "tablet", manufacturer: "GSK", pack_size: "10" });
    const variants = [
      await insertMedicine(db, t.businessId, { ...base, strength: "650 mg", dosage_form: "tablet", manufacturer: "GSK", pack_size: "10" }),
      await insertMedicine(db, t.businessId, { ...base, strength: "500 mg", dosage_form: "syrup", manufacturer: "GSK", pack_size: "10" }),
      await insertMedicine(db, t.businessId, { ...base, strength: "500 mg", dosage_form: "tablet", manufacturer: "Getz", pack_size: "10" }),
      await insertMedicine(db, t.businessId, { ...base, strength: "500 mg", dosage_form: "tablet", manufacturer: "GSK", pack_size: "20" }),
    ];
    await seedConfirmedOrder(db, t.userId, stores["Al Madina"], [a, ...variants].map((id) => catalogLine(id, 2, "strip")), at());

    const list = await dbMarketList(db, t.userId, { date: DAY });
    expect(list.rows).toHaveLength(5);
    expect(new Set(list.rows.map((r) => r.product_id)).size).toBe(5);
    expect(list.rows.every((r) => r.total_requested === 2)).toBe(true);
  });

  it("never adds quantities of different units, and treats units that differ only by case or spaces as one", async () => {
    const { t, stores } = await fresh(["Al Madina", "Shah Medical", "Noor Pharmacy"]);
    const panadol = await insertMedicine(db, t.businessId, { name: "Panadol" });
    await seedConfirmedOrder(db, t.userId, stores["Al Madina"], [catalogLine(panadol, 5, "strip")], at());
    await seedConfirmedOrder(db, t.userId, stores["Shah Medical"], [catalogLine(panadol, 3, "box")], at("11:00"));
    await seedConfirmedOrder(db, t.userId, stores["Noor Pharmacy"], [catalogLine(panadol, 4, "  STRIP ")], at("12:00"));

    const list = await dbMarketList(db, t.userId, { date: DAY });
    expect(list.rows).toHaveLength(2);
    const strip = list.rows.find((r) => r.key.endsWith(":strip"))!;
    const box = list.rows.find((r) => r.key.endsWith(":box"))!;
    expect(strip.total_requested).toBe(9); // 5 + 4
    expect(box.total_requested).toBe(3);
    expect(storeMap(strip)).toEqual({ "Al Madina": 5, "Noor Pharmacy": 4 });
  });

  it("groups typed text ignoring case and repeated spaces, with a store-wise breakdown, and splits by unit", async () => {
    const { t, stores } = await fresh(["Al Madina", "Shah Medical", "Noor Pharmacy"]);
    await seedConfirmedOrder(db, t.userId, stores["Al Madina"], [typedLine(" NORAN 20mg Cap", 4, "strip")], at("09:00"));
    await seedConfirmedOrder(db, t.userId, stores["Shah Medical"], [typedLine("noran  20MG cap", 6, "strip")], at("10:00"));
    await seedConfirmedOrder(db, t.userId, stores["Noor Pharmacy"], [typedLine("Noran 20mg cap", 2, "box")], at("11:00"));

    const list = await dbMarketList(db, t.userId, { date: DAY });
    expect(list.rows).toEqual([]);
    expect(list.typed_rows).toHaveLength(2);
    const strip = list.typed_rows.find((r) => r.key.endsWith(":strip"))!;
    expect(strip.total_requested).toBe(10);
    expect(storeMap(strip)).toEqual({ "Al Madina": 4, "Shah Medical": 6 });
    // The shown spelling is the earliest typed one (cleaned of extra spaces by the order functions).
    expect(strip.typed_name?.toLowerCase()).toBe("noran 20mg cap");
    expect(strip).toMatchObject({ product_id: null, name: null, can_record: false, purchased: 0, remaining: 10, extra: 0, status: "not_bought" });
    expect(list.typed_rows.find((r) => r.key.endsWith(":box"))!.total_requested).toBe(2);
  });

  it("keeps different typed texts apart (no merging by similarity)", async () => {
    const { t, stores } = await fresh(["Al Madina"]);
    await seedConfirmedOrder(db, t.userId, stores["Al Madina"], [typedLine("Noran 20mg cap", 1), typedLine("Noran 40mg cap", 2), typedLine("Noran 20 mg cap", 3)], at());
    const list = await dbMarketList(db, t.userId, { date: DAY });
    expect(list.typed_rows).toHaveLength(3);
  });

  it("still lists an inactive medicine that is on a confirmed order", async () => {
    const { t, stores } = await fresh(["Al Madina"]);
    const panadol = await insertMedicine(db, t.businessId, { name: "Panadol" });
    await seedConfirmedOrder(db, t.userId, stores["Al Madina"], [catalogLine(panadol, 2)], at());
    await db.query(`update public.products set is_active = false where id = $1`, [panadol]);
    const list = await dbMarketList(db, t.userId, { date: DAY });
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0].can_record).toBe(true);
  });

  it("sorts registered rows by name and puts typed rows in their own list sorted by text", async () => {
    const { t, stores } = await fresh(["Al Madina"]);
    const zinc = await insertMedicine(db, t.businessId, { name: "Zinc" });
    const brufen = await insertMedicine(db, t.businessId, { name: "brufen" });
    const panadol = await insertMedicine(db, t.businessId, { name: "Panadol" });
    await seedConfirmedOrder(db, t.userId, stores["Al Madina"], [catalogLine(zinc, 1), catalogLine(panadol, 1), catalogLine(brufen, 1), typedLine("Zeta", 1), typedLine("alpha", 1)], at());
    const list = await dbMarketList(db, t.userId, { date: DAY });
    expect(list.rows.map((r) => r.name)).toEqual(["brufen", "Panadol", "Zinc"]);
    expect(list.typed_rows.map((r) => r.typed_name)).toEqual(["alpha", "Zeta"]);
  });

  it("lists the stores that have confirmed orders on the day (the filter choices), sorted by name", async () => {
    const { t, stores } = await fresh(["Shah Medical", "Al Madina", "Idle Store"]);
    const panadol = await insertMedicine(db, t.businessId, { name: "Panadol" });
    await seedConfirmedOrder(db, t.userId, stores["Shah Medical"], [catalogLine(panadol, 1)], at());
    await seedConfirmedOrder(db, t.userId, stores["Al Madina"], [catalogLine(panadol, 1)], at("11:00"));
    const list = await dbMarketList(db, t.userId, { date: DAY });
    expect(list.stores.map((s) => s.name)).toEqual(["Al Madina", "Shah Medical"]);
    expect(list.business_name).toBe(`list${counter} business`); // the header of the print page
  });
});

describe("what the list never shows", () => {
  it("has no price, cost, MRP, margin or profit key or value at any depth", async () => {
    const { t, stores } = await fresh(["Al Madina"]);
    const priced = await insertMedicine(db, t.businessId, { name: "Panadol", purchase_price: "90.00", selling_price: "125.50", mrp: "130.00" });
    await seedConfirmedOrder(db, t.userId, stores["Al Madina"], [catalogLine(priced, 3), typedLine("Noran", 1)], at());
    const list = await dbMarketList(db, t.userId, { date: DAY });
    expect(moneyKeys(list)).toEqual([]);
    const text = JSON.stringify(list);
    for (const value of ["90.00", "125.50", "130.00"]) expect(text).not.toContain(value);
  });
});

describe("the row cap", () => {
  it("returns at most 2,000 rows and says when the list was cut short", async () => {
    const { t, stores } = await fresh(["Al Madina"]);
    // 11 orders of 200 different typed lines each = 2,200 rows (an order holds at most 200 lines).
    for (let o = 0; o < 11; o += 1) {
      const lines = Array.from({ length: 200 }, (_, i) => typedLine(`Cap item ${String(o * 200 + i).padStart(4, "0")}`, 1));
      await seedConfirmedOrder(db, t.userId, stores["Al Madina"], lines, at());
    }
    const list = await dbMarketList(db, t.userId, { date: DAY });
    expect(list.typed_rows).toHaveLength(2000);
    expect(list.truncated).toBe(true);
    expect(list.totals.typed_rows).toBe(2200); // the totals still describe the whole list
    expect(list.totals.requested).toBe(2200);
  }, 180_000);
});
