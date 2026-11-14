import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import { catalogLine, typedLine } from "../helpers/orders";
import { insertMedicine, insertStore } from "../helpers/pending-db";
import { dbMarketList, dbMarketSummary, dbRecord, pkt, seedConfirmedOrder } from "../helpers/market-db";

// Search, status filter and store filter of the market list, and the promise that the Home count equals the
// length of the "still to buy" list (migration 0006).

const DAY = "2026-11-12";
const at = (time: string) => pkt(DAY, time);

let db: PGlite;
let t: Tenant;
let stores: Record<string, string>;
let panadol: string;
let brufen: string;
let calpol: string;

beforeAll(async () => {
  db = await createTestDb();
  t = await createTenant(db, "filters");
  stores = {};
  for (const name of ["Al Madina", "Shah Medical", "Rehman Medical"]) stores[name] = await insertStore(db, t.businessId, name);
  panadol = await insertMedicine(db, t.businessId, { name: "Panadol", unit: "strip", strength: "500 mg", dosage_form: "tablet", manufacturer: "GSK" });
  brufen = await insertMedicine(db, t.businessId, { name: "Brufen 100%_x", unit: "strip", strength: "400 mg", dosage_form: "tablet", manufacturer: "Abbott" });
  calpol = await insertMedicine(db, t.businessId, { name: "Calpol", unit: "bottle", dosage_form: "syrup" });
  await seedConfirmedOrder(db, t.userId, stores["Al Madina"], [catalogLine(panadol, 20), catalogLine(brufen, 10), typedLine("Noran 20mg cap", 4)], at("10:00"));
  await seedConfirmedOrder(db, t.userId, stores["Shah Medical"], [catalogLine(panadol, 10), catalogLine(calpol, 6, "bottle")], at("11:00"));
  await seedConfirmedOrder(db, t.userId, stores["Rehman Medical"], [catalogLine(panadol, 15), catalogLine(brufen, 5), typedLine("Noran 40mg cap", 3)], at("12:00"));
  // Panadol: bought 30 of 45 (partly); Calpol: bought all 6 (fully); Brufen: nothing bought.
  await dbRecord(db, t.userId, { product: panadol, date: DAY, quantity: 30 });
  await dbRecord(db, t.userId, { product: calpol, unit: "bottle", date: DAY, quantity: 6 });
}, 90_000);

afterAll(async () => {
  await db.close();
});

const names = (list: Awaited<ReturnType<typeof dbMarketList>>) => [...list.rows.map((r) => r.name), ...list.typed_rows.map((r) => r.typed_name)];

describe("search", () => {
  it("matches the name, strength, dosage form, manufacturer and typed text, ignoring case", async () => {
    expect(names(await dbMarketList(db, t.userId, { date: DAY, q: "panad" }))).toEqual(["Panadol"]);
    expect(names(await dbMarketList(db, t.userId, { date: DAY, q: "400 MG" }))).toEqual(["Brufen 100%_x"]);
    expect(names(await dbMarketList(db, t.userId, { date: DAY, q: "SYRUP" }))).toEqual(["Calpol"]);
    expect(names(await dbMarketList(db, t.userId, { date: DAY, q: "abbott" }))).toEqual(["Brufen 100%_x"]);
    expect(names(await dbMarketList(db, t.userId, { date: DAY, q: "noran 40" }))).toEqual(["Noran 40mg cap"]);
  });

  it("needs every word to match, and treats %, _ and \\ as plain characters", async () => {
    expect(names(await dbMarketList(db, t.userId, { date: DAY, q: "panadol syrup" }))).toEqual([]);
    expect(names(await dbMarketList(db, t.userId, { date: DAY, q: "100%" }))).toEqual(["Brufen 100%_x"]);
    expect(names(await dbMarketList(db, t.userId, { date: DAY, q: "%" }))).toEqual(["Brufen 100%_x"]); // not "everything"
    expect(names(await dbMarketList(db, t.userId, { date: DAY, q: "_x" }))).toEqual(["Brufen 100%_x"]);
    expect(names(await dbMarketList(db, t.userId, { date: DAY, q: "\\" }))).toEqual([]);
  });

  it("only hides rows: it never merges or re-groups medicines", async () => {
    const all = await dbMarketList(db, t.userId, { date: DAY });
    const found = await dbMarketList(db, t.userId, { date: DAY, q: "o" });
    for (const row of found.rows) expect(all.rows.find((r) => r.key === row.key)).toEqual(row);
  });
});

describe("status filter", () => {
  it("to_buy keeps rows with something remaining (typed rows included) and hides fully bought ones", async () => {
    const list = await dbMarketList(db, t.userId, { date: DAY, status: "to_buy" });
    expect(list.rows.map((r) => r.name).sort()).toEqual(["Brufen 100%_x", "Panadol"]);
    expect(list.typed_rows).toHaveLength(2);
  });

  it("bought keeps rows with a purchase and no typed rows", async () => {
    const list = await dbMarketList(db, t.userId, { date: DAY, status: "bought" });
    expect(list.rows.map((r) => r.name).sort()).toEqual(["Calpol", "Panadol"]);
    expect(list.typed_rows).toEqual([]);
  });

  it("refuses an unknown status", async () => {
    await expect(dbMarketList(db, t.userId, { date: DAY, status: "done" as never })).rejects.toThrow(/invalid_status/);
  });
});

describe("store filter", () => {
  it("shows only rows a selected store ordered, lists only the selected stores, and keeps whole-day figures", async () => {
    const list = await dbMarketList(db, t.userId, { date: DAY, stores: [stores["Shah Medical"]] });
    expect(names(list)).toEqual(["Calpol", "Panadol"]);
    const row = list.rows.find((r) => r.name === "Panadol")!;
    expect(row.stores).toEqual([{ store_id: stores["Shah Medical"], store_name: "Shah Medical", quantity: 10 }]);
    expect(row).toMatchObject({ shown_requested: 10, total_requested: 45, purchased: 30, remaining: 15 }); // whole day
    expect(list.stores.map((s) => s.name)).toEqual(["Al Madina", "Rehman Medical", "Shah Medical"]); // the choices stay complete
  });

  it("combines several stores and a search", async () => {
    const list = await dbMarketList(db, t.userId, { date: DAY, stores: [stores["Al Madina"], stores["Rehman Medical"]], q: "noran" });
    expect(list.typed_rows.map((r) => [r.typed_name, r.shown_requested])).toEqual([["Noran 20mg cap", 4], ["Noran 40mg cap", 3]]);
  });

  it("treats an empty store list as all stores", async () => {
    const all = await dbMarketList(db, t.userId, { date: DAY });
    const empty = await dbMarketList(db, t.userId, { date: DAY, stores: [] });
    expect(empty.rows).toEqual(all.rows);
  });

  it("shows nothing for a store that has no orders on the day, and ignores an unknown store id", async () => {
    const idle = await insertStore(db, t.businessId, "Idle Store");
    expect(names(await dbMarketList(db, t.userId, { date: DAY, stores: [idle] }))).toEqual([]);
    expect(names(await dbMarketList(db, t.userId, { date: DAY, stores: ["00000000-0000-4000-8000-000000000000"] }))).toEqual([]);
  });
});

describe("the Home count equals the still-to-buy list", () => {
  it("counts rows with something remaining, typed rows included", async () => {
    const summary = await dbMarketSummary(db, t.userId, DAY);
    const toBuy = await dbMarketList(db, t.userId, { date: DAY, status: "to_buy" });
    expect(summary).toMatchObject({ date: DAY, rows_total: 5, typed_rows: 2, typed_to_buy: 2 });
    expect(summary.rows_to_buy).toBe(toBuy.rows.length + toBuy.typed_rows.length);
    expect(summary.rows_to_buy).toBe(4);
  });

  it("follows a purchase: buying the rest of Panadol lowers the count by one, in both places", async () => {
    await dbRecord(db, t.userId, { product: brufen, date: DAY, quantity: 15 }); // Brufen was 15 and is now fully bought
    const summary = await dbMarketSummary(db, t.userId, DAY);
    const toBuy = await dbMarketList(db, t.userId, { date: DAY, status: "to_buy" });
    expect(summary.rows_to_buy).toBe(3);
    expect(summary.rows_to_buy).toBe(toBuy.rows.length + toBuy.typed_rows.length);
  });

  it("is zero rows for a day without orders", async () => {
    expect(await dbMarketSummary(db, t.userId, "2026-01-01")).toMatchObject({ rows_total: 0, rows_to_buy: 0, typed_rows: 0, typed_to_buy: 0 });
  });
});
