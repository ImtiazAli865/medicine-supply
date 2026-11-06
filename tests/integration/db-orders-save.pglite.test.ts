import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogLine, savePayload, seedWithDb, typedLine, type Seeded } from "../helpers/orders";
import { createDraft, dbCancel, dbConfirm, dbGet, dbSave } from "../helpers/orders-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// order_save on existing orders: updates, replays, version conflicts, the store lock, soft removal,
// discarding a draft, and all-or-nothing behaviour when something fails part-way.

let db: PGlite;
let a: Tenant;
let seedA: Seeded;
let secondStore: string;

const n = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: number }>(sql, params)).rows[0].n);

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
  seedA = await seedWithDb(db, a.businessId);
  secondStore = randomUUID();
  await db.query(`insert into public.stores (id, business_id, name) values ($1, $2, 'Second Store')`, [secondStore, a.businessId]);
});
afterAll(async () => {
  await db.close();
});

describe("updating a draft", () => {
  it("moves the version by one and applies notes, quantity, unit and screen order", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 2), catalogLine(seedA.sellingOnlyId, 1, "box")]);
    const [l1, l2] = order.lines;
    const payload = savePayload(
      seedA.storeId,
      [{ ...catalogLine(seedA.sellingOnlyId, 4, "carton"), id: l2.id }, { ...catalogLine(seedA.pricedId, 2), id: l1.id }],
      { expected_version: order.version, notes: "changed" },
    );
    const res = await dbSave(db, a.userId, id, payload);
    expect(res).toMatchObject({ saved: true, replayed: false, created: false });
    expect(res.order).toMatchObject({ version: order.version + 1, notes: "changed" });
    expect(res.order!.lines.map((l) => [l.id, l.position, l.quantity, l.unit])).toEqual([
      [l2.id, 1, 4, "carton"],
      [l1.id, 2, 2, "strip"],
    ]);
    expect(res.order!.events).toHaveLength(1); // a draft edit writes no event
  });

  it("returns the same result and changes nothing when the same request id is sent again", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 1)]);
    const payload = savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId, 9), id: order.lines[0].id }], { expected_version: order.version });
    const first = await dbSave(db, a.userId, id, payload);
    const again = await dbSave(db, a.userId, id, payload);
    expect(again).toMatchObject({ saved: true, replayed: true });
    expect(again.order!.version).toBe(first.order!.version);
    expect(again.order!.lines[0].quantity).toBe(9);
  });

  it("refuses an older version with the current order, and refuses expected_version null for an existing order", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 1)]);
    const line = order.lines[0].id;
    await dbSave(db, a.userId, id, savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId, 2), id: line }], { expected_version: order.version }));
    const stale = await dbSave(db, a.userId, id, savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId, 5), id: line }], { expected_version: order.version }));
    expect(stale).toMatchObject({ saved: false, reason: "version_conflict" });
    expect(stale.current).toMatchObject({ version: order.version + 1 });
    expect(stale.current!.lines[0].quantity).toBe(2); // the newer data was not overwritten
    expect(await dbSave(db, a.userId, id, savePayload(seedA.storeId, [], { expected_version: null }))).toMatchObject({ saved: false, reason: "version_conflict" });
  });

  it("says not_found when a version is sent for an order that does not exist", async () => {
    expect(await dbSave(db, a.userId, randomUUID(), savePayload(seedA.storeId, [], { expected_version: 3 }))).toEqual({ saved: false, reason: "not_found" });
  });

  it("marks a removed line instead of deleting it, and hides it from the order", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 1), catalogLine(seedA.noPriceId, 2, "bottle")]);
    const [keep, drop] = order.lines;
    const res = await dbSave(db, a.userId, id, savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId, 1), id: keep.id }], { expected_version: order.version }));
    expect(res.order!.lines.map((l) => l.id)).toEqual([keep.id]);
    expect(await n(`select count(*)::int as n from public.order_lines where order_id = $1`, [id])).toBe(2); // the row is still there
    const removed = await db.query<{ removed_at: string | null }>(`select removed_at from public.order_lines where id = $1`, [drop.id]);
    expect(removed.rows[0].removed_at).not.toBeNull();
    // a removed line's id can never be used again
    expect(await dbSave(db, a.userId, id, savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId, 1), id: drop.id }], { expected_version: res.order!.version }))).toMatchObject({ saved: false, reason: "invalid_lines" });
  });

  it("cannot change the medicine of an existing line", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 1)]);
    const res = await dbSave(db, a.userId, id, savePayload(seedA.storeId, [{ ...catalogLine(seedA.noPriceId, 1), id: order.lines[0].id }], { expected_version: order.version }));
    expect(res).toMatchObject({ saved: false, reason: "invalid_lines" });
  });
});

describe("the store of an order", () => {
  it("can change while the draft has no lines, even in the same save that adds the first line", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, []);
    const res = await dbSave(db, a.userId, id, savePayload(secondStore, [catalogLine(seedA.pricedId, 1)], { expected_version: order.version }));
    expect(res).toMatchObject({ saved: true });
    expect(res.order!.store).toMatchObject({ id: secondStore, name: "Second Store" });
    expect(res.order!.lines).toHaveLength(1);
  });

  it("is locked once the draft has a line: store_locked, and nothing changes", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 1)]);
    const res = await dbSave(db, a.userId, id, savePayload(secondStore, [], { expected_version: order.version }));
    expect(res).toMatchObject({ saved: false, reason: "store_locked" });
    expect(res.current!.store.id).toBe(seedA.storeId);
    expect(res.current!.lines).toHaveLength(1);
  });

  it("can change again after every line was removed in an earlier save", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 1)]);
    const emptied = await dbSave(db, a.userId, id, savePayload(seedA.storeId, [], { expected_version: order.version }));
    const moved = await dbSave(db, a.userId, id, savePayload(secondStore, [], { expected_version: emptied.order!.version }));
    expect(moved).toMatchObject({ saved: true });
    expect(moved.order!.store.id).toBe(secondStore);
  });

  it("never changes for a confirmed order", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 1)]);
    const confirmed = await dbConfirm(db, a.userId, id, order.version);
    const res = await dbSave(db, a.userId, id, savePayload(secondStore, [{ ...catalogLine(seedA.pricedId, 1), id: order.lines[0].id }], { expected_version: confirmed.order!.version }));
    expect(res).toMatchObject({ saved: false, reason: "store_locked" });
  });

  it("keeps two drafts for two stores apart, line by line", async () => {
    const one = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 1)]);
    const two = await createDraft(db, a.userId, secondStore, [catalogLine(seedA.sellingOnlyId, 2, "box")]);
    expect((await dbGet(db, a.userId, one.id))!.lines.map((l) => l.name)).toEqual(["Panadol 500mg"]);
    expect((await dbGet(db, a.userId, two.id))!.lines.map((l) => l.name)).toEqual(["Brufen 400mg"]);
    const owners = await db.query<{ store_id: string }>(`select o.store_id from public.order_lines l join public.orders o on o.id = l.order_id where l.id = any($1)`, [[one.order.lines[0].id, two.order.lines[0].id]]);
    expect(owners.rows.map((r) => r.store_id).sort()).toEqual([seedA.storeId, secondStore].sort());
  });
});

describe("discarding a draft", () => {
  it("cancels it without a reason, keeps its lines, and shows no live catalog price afterwards", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 2)]);
    expect((await dbGet(db, a.userId, id))!.lines[0]).toMatchObject({ price_basis: "current", selling_price: "125.50" }); // a live draft shows the current price
    const res = await dbCancel(db, a.userId, id, order.version, null);
    expect(res).toMatchObject({ cancelled: true, replayed: false });
    expect(res.order).toMatchObject({ status: "cancelled", cancel_reason: null });
    expect(res.order!.lines).toHaveLength(1);
    // a cancelled order that never had a snapshot shows no price and no total, even though the medicine has one
    expect(res.order!.lines[0]).toMatchObject({ price_basis: "none", selling_price: null, line_total: null });
    expect(res.order!.totals).toMatchObject({ priced_total: "0.00", priced_lines: 0, unpriced_lines: 1 });
    expect(res.order!.events.map((e) => e.event_type)).toEqual(["cancelled", "created"]);
    // repeating it returns the original
    expect(await dbCancel(db, a.userId, id, order.version, null)).toMatchObject({ cancelled: true, replayed: true });
    // and it can no longer be saved or confirmed
    expect(await dbSave(db, a.userId, id, savePayload(seedA.storeId, [], { expected_version: res.order!.version }))).toMatchObject({ saved: false, reason: "order_not_editable" });
    expect(await dbConfirm(db, a.userId, id, res.order!.version)).toMatchObject({ confirmed: false, reason: "order_not_editable" });
  });
});

describe("all or nothing", () => {
  const install = () =>
    db.exec(`
      create or replace function public.test_fail_on_name() returns trigger language plpgsql as $$
      begin if new.name = 'FAIL' then raise exception 'induced failure'; end if; return new; end $$;
      create trigger test_fail before insert on public.order_lines for each row execute function public.test_fail_on_name();
    `);
  const uninstall = () => db.exec(`drop trigger if exists test_fail on public.order_lines; drop function if exists public.test_fail_on_name();`);

  it("a failing first save leaves no order, no lines, no event, and does not use up an order number", async () => {
    await install();
    try {
      const orders = await n(`select count(*)::int as n from public.orders`);
      const lines = await n(`select count(*)::int as n from public.order_lines`);
      const events = await n(`select count(*)::int as n from public.order_events`);
      const counter = (await db.query<{ last_number: number }>(`select last_number from public.order_counters where business_id = $1`, [a.businessId])).rows[0].last_number;

      await expect(dbSave(db, a.userId, randomUUID(), savePayload(seedA.storeId, [catalogLine(seedA.pricedId, 1), typedLine("FAIL")]))).rejects.toThrow(/induced failure/);

      expect(await n(`select count(*)::int as n from public.orders`)).toBe(orders);
      expect(await n(`select count(*)::int as n from public.order_lines`)).toBe(lines);
      expect(await n(`select count(*)::int as n from public.order_events`)).toBe(events);
      expect((await db.query<{ last_number: number }>(`select last_number from public.order_counters where business_id = $1`, [a.businessId])).rows[0].last_number).toBe(counter);
    } finally {
      await uninstall();
    }
    const next = await createDraft(db, a.userId, seedA.storeId, []);
    expect(next.order.order_number).toBeGreaterThan(0);
  });

  it("a failing update leaves the order, its lines, its version and its notes exactly as before", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 2)], "original note");
    await install();
    try {
      const payload = savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId, 50), id: order.lines[0].id }, typedLine("FAIL")], { expected_version: order.version, notes: "changed note" });
      await expect(dbSave(db, a.userId, id, payload)).rejects.toThrow(/induced failure/);
    } finally {
      await uninstall();
    }
    const after = (await dbGet(db, a.userId, id))!;
    expect(after).toMatchObject({ version: order.version, notes: "original note" });
    expect(after.lines.map((l) => [l.id, l.quantity])).toEqual([[order.lines[0].id, 2]]);
    expect(after.events).toHaveLength(1);
  });
});
