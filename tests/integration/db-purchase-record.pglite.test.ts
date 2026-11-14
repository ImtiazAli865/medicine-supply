import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import { catalogLine } from "../helpers/orders";
import { dbCancel } from "../helpers/orders-db";
import { insertMedicine, insertStore, refetch } from "../helpers/pending-db";
import { addDays, dbEntries, dbMarketList, dbRecord, dbVoid, pkt, seedConfirmedOrder, todayPkt } from "../helpers/market-db";

// Purchase recording (migration 0006): partial purchases, cancelling, exactly-once saves, validation, and the
// promise that recording a purchase changes nothing else.

const DAY = "2026-11-12";
const at = (time = "10:00") => pkt(DAY, time);

let db: PGlite;
let counter = 0;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  await db.close();
});

/** A business with Panadol requested 45 on DAY (20 + 10 + 15 from three stores). */
async function panadol45() {
  counter += 1;
  const t: Tenant = await createTenant(db, `buy${counter}`);
  const names = ["Al Madina", "Shah Medical", "Rehman Medical"];
  const stores: string[] = [];
  for (const n of names) stores.push(await insertStore(db, t.businessId, n));
  const product = await insertMedicine(db, t.businessId, { name: "Panadol", unit: "strip" });
  await seedConfirmedOrder(db, t.userId, stores[0], [catalogLine(product, 20)], at());
  await seedConfirmedOrder(db, t.userId, stores[1], [catalogLine(product, 10)], at("11:00"));
  await seedConfirmedOrder(db, t.userId, stores[2], [catalogLine(product, 15)], at("12:00"));
  return { t, product, stores };
}

const row = async (t: Tenant) => (await dbMarketList(db, t.userId, { date: DAY })).rows[0];

describe("partial, full and extra purchases", () => {
  it("20 then 10 of 45 gives purchased 30, remaining 15, partly bought; 15 more is fully bought; 5 more is bought extra 5", async () => {
    const { t, product } = await panadol45();
    expect((await dbRecord(db, t.userId, { product, date: DAY, quantity: 20 })).done).toBe(true);
    expect(await row(t)).toMatchObject({ purchased: 20, remaining: 25, status: "partly_bought" });

    await dbRecord(db, t.userId, { product, date: DAY, quantity: 10 });
    expect(await row(t)).toMatchObject({ purchased: 30, remaining: 15, extra: 0, status: "partly_bought" });

    await dbRecord(db, t.userId, { product, date: DAY, quantity: 15 });
    expect(await row(t)).toMatchObject({ purchased: 45, remaining: 0, extra: 0, status: "fully_bought" });

    await dbRecord(db, t.userId, { product, date: DAY, quantity: 5 });
    expect(await row(t)).toMatchObject({ purchased: 50, remaining: 0, extra: 5, status: "bought_extra" });
  });

  it("matches the unit ignoring case and repeated spaces, and does not count another unit or another day", async () => {
    const { t, product } = await panadol45();
    await dbRecord(db, t.userId, { product, date: DAY, quantity: 4, unit: "  STRIP " });
    await dbRecord(db, t.userId, { product, date: DAY, quantity: 9, unit: "box" }); // another unit: not this row
    await dbRecord(db, t.userId, { product, date: addDays(DAY, -1), quantity: 8 }); // another day: not this list
    expect(await row(t)).toMatchObject({ purchased: 4, remaining: 41 });
  });

  it("accepts a purchase for an inactive medicine (it may still be on confirmed orders)", async () => {
    const { t, product } = await panadol45();
    await db.query(`update public.products set is_active = false where id = $1`, [product]);
    expect((await dbRecord(db, t.userId, { product, date: DAY, quantity: 3 })).done).toBe(true);
  });

  it("stores an empty cost as null (never 0) and keeps a typed cost with two decimals", async () => {
    const { t, product } = await panadol45();
    const none = await dbRecord(db, t.userId, { product, date: DAY, quantity: 1 });
    expect(none.entry?.unit_cost).toBeNull();
    const blank = await dbRecord(db, t.userId, { product, date: DAY, quantity: 1, unit_cost: "   " });
    expect(blank.entry?.unit_cost).toBeNull();
    const priced = await dbRecord(db, t.userId, { product, date: DAY, quantity: 1, unit_cost: "88.5", supplier: "  Karachi Market ", reference: " INV-9 " });
    expect(priced.entry).toMatchObject({ unit_cost: "88.50", supplier_name: "Karachi Market", reference: "INV-9", recorded_by_me: true, cancelled: false, void: null });
  });
});

describe("validation: nothing is written for a refused purchase", () => {
  it.each([
    ["quantity 0", { quantity: 0 }, "quantity"],
    ["quantity 100001", { quantity: 100001 }, "quantity"],
    ["a cost with three decimals", { quantity: 1, unit_cost: "12.345" }, "unit_cost"],
    ["a negative cost", { quantity: 1, unit_cost: "-1" }, "unit_cost"],
    ["a cost that is not a number", { quantity: 1, unit_cost: "abc" }, "unit_cost"],
    ["a supplier over 200 characters", { quantity: 1, supplier: "x".repeat(201) }, "supplier_name"],
    ["a reference over 100 characters", { quantity: 1, reference: "x".repeat(101) }, "reference"],
    ["an empty unit", { quantity: 1, unit: "   " }, "unit"],
    ["a future day", { quantity: 1, date: addDays(todayPkt(), 1) }, "purchase_date"],
    ["a day before 2000", { quantity: 1, date: "1999-12-31" }, "purchase_date"],
  ])("refuses %s with a message on the field", async (_label, extra, field) => {
    const { t, product } = await panadol45();
    const result = await dbRecord(db, t.userId, { product, date: DAY, ...extra });
    expect(result).toMatchObject({ done: false, reason: "invalid_purchase" });
    expect(Object.keys(result.fields ?? {})).toContain(field);
    const count = await db.query<{ n: number }>(`select count(*)::int as n from public.purchase_entries where business_id = $1`, [t.businessId]);
    expect(count.rows[0].n).toBe(0);
  });

  it("refuses a missing medicine and another business's medicine with the same answer", async () => {
    const { t } = await panadol45();
    const other = await createTenant(db, `other${counter}`);
    const foreign = await insertMedicine(db, other.businessId, { name: "Foreign" });
    const missing = await dbRecord(db, t.userId, { product: randomUUID(), date: DAY, quantity: 1 });
    const crafted = await dbRecord(db, t.userId, { product: foreign, date: DAY, quantity: 1 });
    expect(missing).toEqual({ done: false, reason: "product_not_found" });
    expect(crafted).toEqual(missing);
  });
});

describe("exactly once", () => {
  it("returns the stored entry for the same id and the same content, and stores one row", async () => {
    const { t, product } = await panadol45();
    const id = randomUUID();
    const first = await dbRecord(db, t.userId, { id, product, date: DAY, quantity: 12, unit_cost: "90", supplier: "Market A", reference: "R1" });
    const again = await dbRecord(db, t.userId, { id, product, date: DAY, quantity: 12, unit_cost: "90.00", supplier: "Market A", reference: "R1" });
    expect(first).toMatchObject({ done: true, replayed: false });
    expect(again).toMatchObject({ done: true, replayed: true });
    expect(again.entry?.id).toBe(first.entry?.id);
    const count = await db.query<{ n: number }>(`select count(*)::int as n from public.purchase_entries where id = $1`, [id]);
    expect(count.rows[0].n).toBe(1);
    expect((await row(t)).purchased).toBe(12);
  });

  it("refuses the same id with different content", async () => {
    const { t, product } = await panadol45();
    const id = randomUUID();
    await dbRecord(db, t.userId, { id, product, date: DAY, quantity: 12 });
    expect(await dbRecord(db, t.userId, { id, product, date: DAY, quantity: 13 })).toEqual({ done: false, reason: "request_reused" });
    expect(await dbRecord(db, t.userId, { id, product, date: DAY, quantity: 12, unit: "box" })).toEqual({ done: false, reason: "request_reused" });
    expect((await row(t)).purchased).toBe(12);
  });

  it("keeps the same entry id of two businesses separate", async () => {
    const a = await panadol45();
    const b = await panadol45();
    const id = randomUUID();
    const first = await dbRecord(db, a.t.userId, { id, product: a.product, date: DAY, quantity: 5 });
    const second = await dbRecord(db, b.t.userId, { id, product: b.product, date: DAY, quantity: 9 });
    expect(first).toMatchObject({ done: true, replayed: false });
    expect(second).toMatchObject({ done: true, replayed: false }); // never a replay of the other business's entry
    expect((await row(a.t)).purchased).toBe(5);
    expect((await row(b.t)).purchased).toBe(9);
  });

  it("serialises simultaneous identical requests into one entry", async () => {
    const { t, product } = await panadol45();
    const id = randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => dbRecord(db, t.userId, { id, product, date: DAY, quantity: 6 })));
    expect(results.every((r) => r.done === true)).toBe(true);
    expect(results.filter((r) => r.replayed === false)).toHaveLength(1);
    const count = await db.query<{ n: number }>(`select count(*)::int as n from public.purchase_entries where id = $1`, [id]);
    expect(count.rows[0].n).toBe(1);
  });
});

describe("cancelling an entry", () => {
  it("removes it from purchased, keeps it in the history with its reason, and returns the row to Not bought when it was the only one", async () => {
    const { t, product } = await panadol45();
    const entry = await dbRecord(db, t.userId, { product, date: DAY, quantity: 20 });
    const voided = await dbVoid(db, t.userId, entry.entry!.id, "  Typed the wrong number ");
    expect(voided).toMatchObject({ done: true, replayed: false });
    expect(voided.entry).toMatchObject({ cancelled: true, void: { reason: "Typed the wrong number", by_me: true } });
    expect(await row(t)).toMatchObject({ purchased: 0, remaining: 45, status: "not_bought" });

    const history = await dbEntries(db, t.userId, product, "strip", DAY);
    expect(history).toMatchObject({ found: true, purchased: 0, requested: 45 });
    if (history.found) {
      expect(history.entries).toHaveLength(1);
      expect(history.entries[0]).toMatchObject({ id: entry.entry!.id, quantity: 20, cancelled: true });
    }
  });

  it("lists entries newest first with the cancelled ones marked, and a corrected entry counts", async () => {
    const { t, product } = await panadol45();
    const wrong = await dbRecord(db, t.userId, { product, date: DAY, quantity: 200 });
    await dbVoid(db, t.userId, wrong.entry!.id, "Extra zero");
    const right = await dbRecord(db, t.userId, { product, date: DAY, quantity: 20 });
    const history = await dbEntries(db, t.userId, product, "strip", DAY);
    expect(history.found).toBe(true);
    if (history.found) {
      expect(history.entries.map((e) => e.id)).toEqual([right.entry!.id, wrong.entry!.id]);
      expect(history.entries.map((e) => e.cancelled)).toEqual([false, true]);
      expect(history.purchased).toBe(20);
    }
  });

  it("cancels once: a second cancel replays and keeps the first reason; an empty reason is refused", async () => {
    const { t, product } = await panadol45();
    const entry = await dbRecord(db, t.userId, { product, date: DAY, quantity: 5 });
    expect(await dbVoid(db, t.userId, entry.entry!.id, "   ")).toMatchObject({ done: false, reason: "invalid_void" });
    expect(await dbVoid(db, t.userId, entry.entry!.id, "x".repeat(501))).toMatchObject({ done: false, reason: "invalid_void" });
    await dbVoid(db, t.userId, entry.entry!.id, "First reason");
    const again = await dbVoid(db, t.userId, entry.entry!.id, "Second reason");
    expect(again).toMatchObject({ done: true, replayed: true });
    expect(again.entry?.void?.reason).toBe("First reason");
    const count = await db.query<{ n: number }>(`select count(*)::int as n from public.purchase_voids where entry_id = $1`, [entry.entry!.id]);
    expect(count.rows[0].n).toBe(1);
  });

  it("answers a missing entry and another business's entry in the same way", async () => {
    const a = await panadol45();
    const b = await panadol45();
    const entry = await dbRecord(db, a.t.userId, { product: a.product, date: DAY, quantity: 5 });
    const missing = await dbVoid(db, b.t.userId, randomUUID(), "x");
    const crafted = await dbVoid(db, b.t.userId, entry.entry!.id, "not mine");
    expect(missing).toEqual({ done: false, reason: "not_found" });
    expect(crafted).toEqual(missing);
    expect((await row(a.t)).purchased).toBe(5); // untouched
  });

  it("reports no history for a medicine that is not the business's own", async () => {
    const a = await panadol45();
    const b = await panadol45();
    expect(await dbEntries(db, b.t.userId, a.product, "strip", DAY)).toEqual({ found: false });
  });
});

describe("a purchase changes nothing else (FR-015)", () => {
  async function dump(businessId: string) {
    const tables = ["orders", "order_lines", "order_events", "products", "pending_requests", "stores"];
    const out: Record<string, unknown[]> = {};
    for (const table of tables) {
      const res = await db.query(`select * from public.${table} where business_id = $1 order by 1`, [businessId]);
      out[table] = res.rows;
    }
    return out;
  }

  it("leaves orders, order lines (quantities, delivered quantities, snapshots), history, medicines and stores identical", async () => {
    const { t, product, stores } = await panadol45();
    const before = await dump(t.businessId);
    const entry = await dbRecord(db, t.userId, { product, date: DAY, quantity: 30, unit_cost: "91.00", supplier: "Market" });
    await dbRecord(db, t.userId, { product, date: DAY, quantity: 20 });
    await dbVoid(db, t.userId, entry.entry!.id, "Typed wrongly");
    expect(await dump(t.businessId)).toEqual(before);
    expect(stores).toHaveLength(3);
  });

  it("does not change the medicine's purchase price (that is a separate, confirmed step)", async () => {
    const { t, product } = await panadol45();
    await db.query(`update public.products set purchase_price = 80 where id = $1`, [product]);
    await dbRecord(db, t.userId, { product, date: DAY, quantity: 5, unit_cost: "99.00" });
    const res = await db.query<{ purchase_price: string }>(`select purchase_price::text as purchase_price from public.products where id = $1`, [product]);
    expect(res.rows[0].purchase_price).toBe("80.00");
  });

  it("keeps the order untouched when it is cancelled after a purchase (purchases stay recorded)", async () => {
    const { t, product, stores } = await panadol45();
    await dbRecord(db, t.userId, { product, date: DAY, quantity: 10 });
    const orderRow = await db.query<{ id: string }>(`select id from public.orders where store_id = $1`, [stores[0]]);
    const current = await refetch(db, t.userId, orderRow.rows[0].id);
    await dbCancel(db, t.userId, current.id, current.version, "Cancelled by the store");
    expect((await row(t)).purchased).toBe(10);
  });
});
