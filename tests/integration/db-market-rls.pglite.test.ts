import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";
import { catalogLine, typedLine } from "../helpers/orders";
import { insertMedicine, insertStore } from "../helpers/pending-db";
import { dbEntries, dbMarketList, dbMarketSummary, dbRecord, dbVoid, pkt, seedConfirmedOrder, todayPkt, addDays } from "../helpers/market-db";

// Two businesses on one database: whatever business B asks for, it gets the answer of "nothing there", and
// nothing of business A changes (migration 0006, every function and both tables).

const DAY = addDays(todayPkt(), -1);

let db: PGlite;
let a: Tenant;
let b: Tenant;
let storeA: string;
let productA: string;
let entryA: string;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "rls-a");
  b = await createTenant(db, "rls-b");
  storeA = await insertStore(db, a.businessId, "A Store");
  await insertStore(db, b.businessId, "B Store");
  productA = await insertMedicine(db, a.businessId, { name: "A Panadol", unit: "strip" });
  await seedConfirmedOrder(db, a.userId, storeA, [catalogLine(productA, 20), typedLine("A typed", 3)], pkt(DAY, "10:00"));
  entryA = (await dbRecord(db, a.userId, { product: productA, date: DAY, quantity: 8, unit_cost: "90.00" })).entry!.id;
}, 90_000);

afterAll(async () => {
  await db.close();
});

describe("reads", () => {
  it("shows business B an empty list and an empty summary, whatever the day", async () => {
    const list = await dbMarketList(db, b.userId, { date: DAY });
    expect(list).toMatchObject({ rows: [], typed_rows: [], stores: [] });
    expect(list.totals.requested).toBe(0);
    expect(await dbMarketSummary(db, b.userId, DAY)).toMatchObject({ rows_total: 0, rows_to_buy: 0 });
  });

  it("shows business B no history for A's medicine, even with the exact ids", async () => {
    expect(await dbEntries(db, b.userId, productA, "strip", DAY)).toEqual({ found: false });
  });

  it("lets A still see everything it recorded", async () => {
    const list = await dbMarketList(db, a.userId, { date: DAY });
    expect(list.rows[0]).toMatchObject({ total_requested: 20, purchased: 8 });
    expect(list.typed_rows).toHaveLength(1);
  });

  it("lets a signed-in user read only their own rows of both tables directly", async () => {
    const own = await withRole(db, "authenticated", a.userId, async () => (await db.query<{ n: number }>(`select count(*)::int as n from public.purchase_entries`)).rows[0].n);
    const other = await withRole(db, "authenticated", b.userId, async () => (await db.query<{ n: number }>(`select count(*)::int as n from public.purchase_entries`)).rows[0].n);
    expect([own, other]).toEqual([1, 0]);
  });
});

describe("writes", () => {
  it("answers a crafted medicine id and a missing one in the same way and writes nothing", async () => {
    const crafted = await dbRecord(db, b.userId, { product: productA, date: DAY, quantity: 5 });
    const missing = await dbRecord(db, b.userId, { product: randomUUID(), date: DAY, quantity: 5 });
    expect(crafted).toEqual({ done: false, reason: "product_not_found" });
    expect(missing).toEqual(crafted);
    const rows = await db.query<{ n: number }>(`select count(*)::int as n from public.purchase_entries where business_id = $1`, [b.businessId]);
    expect(rows.rows[0].n).toBe(0);
  });

  it("answers a crafted entry id in a cancel like a missing one, and A's entry is untouched", async () => {
    const crafted = await dbVoid(db, b.userId, entryA, "Not mine");
    const missing = await dbVoid(db, b.userId, randomUUID(), "Not mine");
    expect(crafted).toEqual({ done: false, reason: "not_found" });
    expect(missing).toEqual(crafted);
    const history = await dbEntries(db, a.userId, productA, "strip", DAY);
    expect(history.found && history.entries[0].cancelled).toBe(false);
  });

  it("keeps the same entry id of two businesses apart: B's record is its own row and never a replay of A's", async () => {
    const productB = await insertMedicine(db, b.businessId, { name: "B Panadol", unit: "strip" });
    const result = await dbRecord(db, b.userId, { id: entryA, product: productB, date: DAY, quantity: 3 });
    expect(result).toMatchObject({ done: true, replayed: false });
    const mine = await dbEntries(db, a.userId, productA, "strip", DAY);
    expect(mine.found && mine.entries).toHaveLength(1);
    expect(mine.found && mine.entries[0].quantity).toBe(8); // A's row is unchanged
  });

  it("refuses direct inserts, updates and deletes by a signed-in user", async () => {
    const asB = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", b.userId, fn);
    await expect(asB(() => db.query(`update public.purchase_entries set quantity = 1`))).rejects.toThrow(/permission denied/);
    await expect(asB(() => db.query(`delete from public.purchase_voids`))).rejects.toThrow(/permission denied/);
    await expect(asB(() => db.query(`insert into public.purchase_entries (id, product_id, unit, purchase_date, quantity) values ($1, $2, 'strip', $3, 1)`, [randomUUID(), productA, DAY]))).rejects.toThrow(/permission denied/);
  });
});

describe("a user without a business", () => {
  it("gets no_business from every function", async () => {
    const orphan = await db.query<{ id: string }>(`insert into auth.users (email) values ('orphan@example.test') returning id`);
    const userId = orphan.rows[0].id;
    await expect(dbMarketList(db, userId, { date: DAY })).rejects.toThrow(/no_business/);
    await expect(dbMarketSummary(db, userId, DAY)).rejects.toThrow(/no_business/);
    await expect(dbRecord(db, userId, { product: productA, date: DAY, quantity: 1 })).rejects.toThrow(/no_business/);
    await expect(dbVoid(db, userId, entryA, "x")).rejects.toThrow(/no_business/);
  });
});
