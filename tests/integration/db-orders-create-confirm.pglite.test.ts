import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogLine, savePayload, seedWithDb, typedLine, type Seeded } from "../helpers/orders";
import { dbConfirm, dbGet, dbSave, createDraft } from "../helpers/orders-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// order_save (create) and order_confirm on a real PostgreSQL engine (PGlite), as a signed-in user.

let db: PGlite;
let a: Tenant;
let b: Tenant;
let seedA: Seeded;
let seedB: Seeded;

const count = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: number }>(sql, params)).rows[0].n);
const orderCount = () => count(`select count(*)::int as n from public.orders where business_id = $1`, [a.businessId]);

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
  b = await createTenant(db, "b");
  seedA = await seedWithDb(db, a.businessId);
  seedB = await seedWithDb(db, b.businessId, "B Pharmacy");
});
afterAll(async () => {
  await db.close();
});

describe("creating a draft", () => {
  it("creates a draft with order number 1 and a created event on the first save", async () => {
    const id = randomUUID();
    const payload = savePayload(seedA.storeId, [catalogLine(seedA.pricedId, 2, "strip"), catalogLine(seedA.sellingOnlyId, 5, "box")], { notes: "  Deliver before noon  " });
    const res = await dbSave(db, a.userId, id, payload);
    expect(res).toMatchObject({ saved: true, replayed: false, created: true });
    const order = res.order!;
    expect(order).toMatchObject({ id, order_number: 1, status: "draft", source: "manual", version: 1, notes: "Deliver before noon", store: { id: seedA.storeId, name: "Al Shifa Pharmacy" } });
    expect(order.lines.map((l) => [l.name, l.quantity, l.unit, l.position])).toEqual([
      ["Panadol 500mg", 2, "strip", 1],
      ["Brufen 400mg", 5, "box", 2],
    ]);
    expect(order.events).toHaveLength(1);
    expect(order.events[0]).toMatchObject({ event_type: "created", order_version: 1 });
    expect(order.events[0].detail).toMatchObject({ created: { store_id: seedA.storeId, order_number: 1 } });
  });

  it("gives the next order the next number", async () => {
    const second = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.noPriceId, 1, "bottle")]);
    expect(second.order.order_number).toBe(2);
  });

  it("allows a draft with no lines yet (a store and notes only)", async () => {
    const empty = await createDraft(db, a.userId, seedA.storeId, [], "just a note");
    expect(empty.order.lines).toEqual([]);
    expect(empty.order.totals).toMatchObject({ line_count: 0, priced_total: "0.00", unpriced_lines: 0 });
  });

  it("copies the medicine's description into catalog lines and takes no price snapshot while draft", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 1)]);
    expect(order.lines[0]).toMatchObject({ name: "Panadol 500mg", strength: "500 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK", item_status: "registered" });
    const row = await db.query<{ purchase_price_snapshot: string | null; selling_price_snapshot: string | null; mrp_snapshot: string | null; snapshot_taken_at: string | null; delivered_quantity: number | null }>(
      `select purchase_price_snapshot, selling_price_snapshot, mrp_snapshot, snapshot_taken_at, delivered_quantity from public.order_lines where order_id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({ purchase_price_snapshot: null, selling_price_snapshot: null, mrp_snapshot: null, snapshot_taken_at: null, delivered_quantity: null });
  });

  it("refuses an unknown store, another business's store and an inactive store, and creates nothing", async () => {
    const before = await orderCount();
    expect(await dbSave(db, a.userId, randomUUID(), savePayload(randomUUID(), []))).toMatchObject({ saved: false, reason: "store_not_found" });
    expect(await dbSave(db, a.userId, randomUUID(), savePayload(seedB.storeId, []))).toMatchObject({ saved: false, reason: "store_not_found" });
    await db.query(`update public.stores set is_active = false where id = $1`, [seedA.storeId]);
    try {
      expect(await dbSave(db, a.userId, randomUUID(), savePayload(seedA.storeId, []))).toMatchObject({ saved: false, reason: "store_inactive" });
    } finally {
      await db.query(`update public.stores set is_active = true where id = $1`, [seedA.storeId]);
    }
    expect(await orderCount()).toBe(before);
  });

  it("refuses bad lines with a reason and a message, and does not use up an order number", async () => {
    const before = await orderCount();
    const numberBefore = (await createDraft(db, a.userId, seedA.storeId, [])).order.order_number;
    const bad: Array<[string, ReturnType<typeof savePayload>]> = [
      ["more than 200 lines", savePayload(seedA.storeId, Array.from({ length: 201 }, () => catalogLine(seedA.pricedId)))],
      ["duplicate line ids", savePayload(seedA.storeId, (() => { const l = catalogLine(seedA.pricedId); return [l, { ...l }]; })())],
      ["an unknown medicine", savePayload(seedA.storeId, [catalogLine(randomUUID())])],
      ["another business's medicine", savePayload(seedA.storeId, [catalogLine(seedB.pricedId)])],
      ["quantity 0", savePayload(seedA.storeId, [catalogLine(seedA.pricedId, 0)])],
      ["quantity 100001", savePayload(seedA.storeId, [catalogLine(seedA.pricedId, 100001)])],
      ["an empty unit", savePayload(seedA.storeId, [catalogLine(seedA.pricedId, 1, "  ")])],
      ["a typed line without a name", savePayload(seedA.storeId, [typedLine("   ")])],
      ["a malformed medicine id", savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId), product_id: "not-a-uuid" }])],
    ];
    for (const [label, payload] of bad) {
      const res = await dbSave(db, a.userId, randomUUID(), payload);
      expect(res, label).toMatchObject({ saved: false, reason: "invalid_lines" });
      expect(res.detail?.message, label).toBeTruthy();
    }
    expect(await orderCount()).toBe(before + 1); // only the one draft created above
    const numberAfter = (await createDraft(db, a.userId, seedA.storeId, [])).order.order_number;
    expect(numberAfter).toBe(numberBefore + 1);
  });

  it("refuses a new line for an inactive medicine", async () => {
    await db.query(`update public.products set is_active = false where id = $1`, [seedA.noPriceId]);
    try {
      expect(await dbSave(db, a.userId, randomUUID(), savePayload(seedA.storeId, [catalogLine(seedA.noPriceId)]))).toMatchObject({ saved: false, reason: "invalid_lines" });
    } finally {
      await db.query(`update public.products set is_active = true where id = $1`, [seedA.noPriceId]);
    }
  });

  it("refuses a line id that already belongs to another order", async () => {
    const first = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId)]);
    const stolen = { ...catalogLine(seedA.pricedId), id: first.order.lines[0].id };
    expect(await dbSave(db, a.userId, randomUUID(), savePayload(seedA.storeId, [stolen]))).toMatchObject({ saved: false, reason: "invalid_lines" });
  });

  it("reports an order id that belongs to another business as unusable, revealing nothing", async () => {
    const { id } = await createDraft(db, b.userId, seedB.storeId, []);
    expect(await dbSave(db, a.userId, id, savePayload(seedA.storeId, []))).toEqual({ saved: false, reason: "unusable_id" });
  });

  it("cleans a typed name and a unit even when the function is called directly", async () => {
    const { order } = await createDraft(db, a.userId, seedA.storeId, [typedLine("  Panadol   500  ", 2, "  box ")]);
    expect(order.lines[0]).toMatchObject({ name: "Panadol 500", unit: "box", item_status: "pending_registration", product_id: null });
  });
});

describe("confirming", () => {
  it("confirms a draft: status, confirmed time and one confirmed event; delivered quantity equals the ordered quantity", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 3), catalogLine(seedA.noPriceId, 7, "bottle")]);
    const res = await dbConfirm(db, a.userId, id, order.version);
    expect(res).toMatchObject({ confirmed: true, replayed: false });
    expect(res.order).toMatchObject({ status: "confirmed", version: order.version + 1 });
    expect(res.order!.confirmed_at).toBeTruthy();
    expect(res.order!.events.map((e) => e.event_type)).toEqual(["confirmed", "created"]);
    expect(res.order!.events[0].detail).toMatchObject({ confirmed: { line_count: 2, priced_lines: 1, unpriced_lines: 1, priced_total: "376.50" } });
    const rows = await db.query<{ quantity: number; delivered_quantity: number }>(`select quantity, delivered_quantity from public.order_lines where order_id = $1 order by position`, [id]);
    expect(rows.rows).toEqual([{ quantity: 3, delivered_quantity: 3 }, { quantity: 7, delivered_quantity: 7 }]);
  });

  it("refuses to confirm an order with no lines and leaves it a draft", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, []);
    expect(await dbConfirm(db, a.userId, id, order.version)).toEqual({ confirmed: false, reason: "order_empty" });
    expect((await dbGet(db, a.userId, id))!.status).toBe("draft");
  });

  it("returns the original when the order is already confirmed, with no second event and no second snapshot", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId)]);
    const first = await dbConfirm(db, a.userId, id, order.version);
    // the catalog price changes between the two confirmations
    await db.query(`update public.products set selling_price = '999.00' where id = $1`, [seedA.pricedId]);
    try {
      const again = await dbConfirm(db, a.userId, id, order.version);
      expect(again).toMatchObject({ confirmed: true, replayed: true });
      expect(again.order!.version).toBe(first.order!.version);
      expect(again.order!.lines[0].selling_price).toBe("125.50");
      expect(again.order!.events.filter((e) => e.event_type === "confirmed")).toHaveLength(1);
      // a different request id (a second tab) gets the same answer, whatever version it carries
      expect(await dbConfirm(db, a.userId, id, 1, randomUUID())).toMatchObject({ confirmed: true, replayed: true });
    } finally {
      await db.query(`update public.products set selling_price = '125.50' where id = $1`, [seedA.pricedId]);
    }
  });

  it("refuses a confirmation based on an older version and returns the current order", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId)]);
    const res = await dbConfirm(db, a.userId, id, order.version + 5);
    expect(res).toMatchObject({ confirmed: false, reason: "version_conflict" });
    expect(res.current!.status).toBe("draft");
    expect(await dbConfirm(db, a.userId, id, null)).toMatchObject({ confirmed: false, reason: "version_conflict" });
  });

  it("says not_found for an unknown order and for another business's order", async () => {
    expect(await dbConfirm(db, a.userId, randomUUID(), 1)).toEqual({ confirmed: false, reason: "not_found" });
    const { id, order } = await createDraft(db, b.userId, seedB.storeId, [catalogLine(seedB.pricedId)]);
    expect(await dbConfirm(db, a.userId, id, order.version)).toEqual({ confirmed: false, reason: "not_found" });
    expect((await dbGet(db, b.userId, id))!.status).toBe("draft");
  });
});
