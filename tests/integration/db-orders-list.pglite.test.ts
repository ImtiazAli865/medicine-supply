import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogLine, seedWithDb, type Seeded } from "../helpers/orders";
import { createDraft, dbList } from "../helpers/orders-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// order_list: newest first, every filter alone and combined, Pakistan-day boundaries, order-number and
// store-name search, paging, and totals (live price for drafts, snapshot for confirmed orders).

let db: PGlite;
let a: Tenant;
let b: Tenant;
let seedA: Seeded;
let store2: string;
const ids: Record<string, string> = {};

async function insertOrder(key: string, over: { store: string; number: number; createdAt: string; status?: string; confirmedAt?: string; cancelledAt?: string; reason?: string }) {
  const id = randomUUID();
  ids[key] = id;
  await db.query(
    `insert into public.orders (id, business_id, store_id, order_number, status, created_at, confirmed_at, cancelled_at, cancel_reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, a.businessId, over.store, over.number, over.status ?? "draft", over.createdAt, over.confirmedAt ?? null, over.cancelledAt ?? null, over.reason ?? null],
  );
  return id;
}

async function insertLine(orderId: string, product: string | null, quantity: number, over: { snapshot?: string; name?: string } = {}) {
  await db.query(
    `insert into public.order_lines (id, business_id, order_id, position, product_id, item_status, name, quantity, unit, selling_price_snapshot, snapshot_taken_at)
     values ($1, $2, $3, 1, $4, $5, $6, $7, 'strip', $8, $9)`,
    [randomUUID(), a.businessId, orderId, product, product ? "registered" : "pending_registration", over.name ?? "Panadol 500mg", quantity, over.snapshot ?? null, over.snapshot ? new Date() : null],
  );
}

const numbers = (rows: { order_number: number }[]) => rows.map((r) => r.order_number);

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
  b = await createTenant(db, "b");
  seedA = await seedWithDb(db, a.businessId); // store1: "Al Shifa Pharmacy"
  store2 = randomUUID();
  await db.query(`insert into public.stores (id, business_id, name) values ($1, $2, 'Second Store')`, [store2, a.businessId]);
  const seedB = await seedWithDb(db, b.businessId, "B Pharmacy");

  // Pakistan is UTC+5: 18:30Z on 5 Nov is 23:30 on 5 Nov, 19:30Z is 00:30 on 6 Nov.
  const o1 = await insertOrder("o1", { store: seedA.storeId, number: 1, createdAt: "2026-11-05T18:30:00Z" });
  await insertLine(o1, seedA.pricedId, 2); // draft: live price 125.50 -> 251.00
  const o2 = await insertOrder("o2", { store: seedA.storeId, number: 2, createdAt: "2026-11-05T19:30:00Z", status: "confirmed", confirmedAt: "2026-11-05T19:31:00Z" });
  await insertLine(o2, seedA.pricedId, 3, { snapshot: "100.00" }); // snapshot 100.00 -> 300.00 (catalog says 125.50)
  const o3 = await insertOrder("o3", { store: store2, number: 12, createdAt: "2026-11-06T05:00:00Z", status: "cancelled", cancelledAt: "2026-11-06T05:10:00Z" });
  await insertLine(o3, seedA.pricedId, 1); // a discarded draft: no snapshot, so no price
  await insertOrder("o4", { store: store2, number: 112, createdAt: "2026-11-06T06:00:00Z" });
  await db.query(`insert into public.orders (id, business_id, store_id, order_number, created_at) values ($1, $2, $3, 1, '2026-11-06T07:00:00Z')`, [randomUUID(), b.businessId, seedB.storeId]);
});
afterAll(async () => {
  await db.close();
});

describe("order_list", () => {
  it("lists newest first, each order as its own row, with the store name", async () => {
    const rows = await dbList(db, a.userId);
    expect(numbers(rows)).toEqual([112, 12, 2, 1]);
    expect(rows.map((r) => r.store.name)).toEqual(["Second Store", "Second Store", "Al Shifa Pharmacy", "Al Shifa Pharmacy"]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(4); // two orders for one store on one day stay separate
  });

  it("shows the line count and the total: live price for a draft, the snapshot for a confirmed order, nothing for a discarded draft", async () => {
    const rows = Object.fromEntries((await dbList(db, a.userId)).map((r) => [r.order_number, r]));
    expect(rows[1]).toMatchObject({ status: "draft", line_count: 1, priced_total: "251.00", unpriced_lines: 0 });
    expect(rows[2]).toMatchObject({ status: "confirmed", line_count: 1, priced_total: "300.00", unpriced_lines: 0 });
    expect(rows[12]).toMatchObject({ status: "cancelled", line_count: 1, priced_total: "0.00", unpriced_lines: 1 });
    expect(rows[112]).toMatchObject({ status: "draft", line_count: 0, priced_total: "0.00", unpriced_lines: 0 });
  });

  it("filters by store", async () => {
    expect(numbers(await dbList(db, a.userId, { store: seedA.storeId }))).toEqual([2, 1]);
    expect(numbers(await dbList(db, a.userId, { store: store2 }))).toEqual([112, 12]);
  });

  it("filters by status", async () => {
    expect(numbers(await dbList(db, a.userId, { status: "draft" }))).toEqual([112, 1]);
    expect(numbers(await dbList(db, a.userId, { status: "confirmed" }))).toEqual([2]);
    expect(numbers(await dbList(db, a.userId, { status: "cancelled" }))).toEqual([12]);
  });

  it("filters by Pakistan day: 23:30 on 5 Nov belongs to 5 Nov, 00:30 on 6 Nov to 6 Nov", async () => {
    expect(numbers(await dbList(db, a.userId, { from: "2026-11-05", to: "2026-11-05" }))).toEqual([1]);
    expect(numbers(await dbList(db, a.userId, { from: "2026-11-06", to: "2026-11-06" }))).toEqual([112, 12, 2]);
    expect(numbers(await dbList(db, a.userId, { from: "2026-11-06" }))).toEqual([112, 12, 2]);
    expect(numbers(await dbList(db, a.userId, { to: "2026-11-05" }))).toEqual([1]);
    expect(numbers(await dbList(db, a.userId, { from: "2026-11-05", to: "2026-11-06" }))).toEqual([112, 12, 2, 1]);
    expect(numbers(await dbList(db, a.userId, { from: "2026-11-07" }))).toEqual([]);
  });

  it("searches by order number (12, #12, ORD-0012) and by store-name words", async () => {
    expect(numbers(await dbList(db, a.userId, { q: "12" }))).toEqual([112, 12]); // a part of the number
    expect(numbers(await dbList(db, a.userId, { q: "#12" }))).toEqual([112, 12]);
    expect(numbers(await dbList(db, a.userId, { q: "ORD-0012" }))).toEqual([112, 12]);
    expect(numbers(await dbList(db, a.userId, { q: "ord 0002" }))).toEqual([112, 12, 2]); // "2" is a part of 112, 12 and 2
    expect(numbers(await dbList(db, a.userId, { q: "shifa" }))).toEqual([2, 1]);
    expect(numbers(await dbList(db, a.userId, { q: "SECOND store" }))).toEqual([112, 12]);
    expect(numbers(await dbList(db, a.userId, { q: "nothing like this" }))).toEqual([]);
  });

  it("combines filters", async () => {
    expect(numbers(await dbList(db, a.userId, { store: store2, status: "draft", from: "2026-11-06", q: "112" }))).toEqual([112]);
    expect(numbers(await dbList(db, a.userId, { store: seedA.storeId, status: "cancelled" }))).toEqual([]);
  });

  it("pages with limit + 1 rows so the caller can tell another page exists", async () => {
    const first = await dbList(db, a.userId, { limit: 2, offset: 0 });
    expect(numbers(first)).toEqual([112, 12, 2]); // limit 2 returns 3
    expect(numbers(await dbList(db, a.userId, { limit: 2, offset: 2 }))).toEqual([2, 1]);
    expect(numbers(await dbList(db, a.userId, { limit: 2, offset: 4 }))).toEqual([]);
  });

  it("never returns another business's orders", async () => {
    const mine = await dbList(db, a.userId);
    const theirs = await dbList(db, b.userId);
    expect(mine).toHaveLength(4);
    expect(theirs).toHaveLength(1);
    expect(theirs[0].store.name).toBe("B Pharmacy");
  });

  it("lists the orders created through order_save too, in order of creation", async () => {
    const { id } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 1)]);
    const rows = await dbList(db, a.userId, { q: "shifa" });
    expect(rows[0].id).toBe(id); // created now, so the newest
  });
});
