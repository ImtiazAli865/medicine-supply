import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbCancel } from "../helpers/orders-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import { catalogLine, createPendingOrder, dbPreview, dbPriceApply, dbPriceApplyRaw, insertMedicine, insertStore, refetch, typedLine } from "../helpers/pending-db";

// Pending Prices on a real PostgreSQL engine (PGlite): a price is entered once, the supplier reviews the exact lines,
// and only lines without a price snapshot are filled, all or nothing. A line that already has a price never changes.

let db: PGlite;
let a: Tenant;
let b: Tenant;
let storeA: string;
let storeB: string;
let counter = 0;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
  b = await createTenant(db, "b");
  storeA = await insertStore(db, a.businessId, "Alpha Store");
  storeB = await insertStore(db, b.businessId, "Other Business Store");
}, 60_000);

afterAll(async () => {
  await db.close();
});

const medicine = (fields: Record<string, unknown> = {}) => insertMedicine(db, a.businessId, { name: `Fill ${(counter += 1)}`, unit: "strip", ...fields });
const confirmed = (productId: string, quantity = 3, store = storeA) => createPendingOrder(db, a.userId, store, [catalogLine(productId, quantity, "strip")], { confirm: true });

const row = async (id: string) => (await db.query<Record<string, unknown>>(`select * from public.order_lines where id = $1`, [id])).rows[0];
const productRow = async (id: string) => (await db.query<Record<string, unknown>>(`select * from public.products where id = $1`, [id])).rows[0];
const eventsOf = async (orderId: string, type = "price_filled") =>
  (await db.query<{ detail: { price_filled: Array<Record<string, unknown>> }; order_version: number; actor: string | null }>(`select detail, order_version, actor from public.order_events where order_id = $1 and event_type = $2 order by created_at`, [orderId, type])).rows;
const totals = async () =>
  (await db.query<Record<string, string>>(`select (select count(*) from public.order_events where event_type = 'price_filled') as events, (select count(*) from public.pending_requests) as requests`)).rows[0];
const flagOff = async () => ((await db.query<{ v: string | null }>(`select current_setting('app.line_snapshot_edit', true) as v`)).rows[0].v ?? "") !== "on";

describe("preview", () => {
  it("lists exactly the waiting lines and counts the lines that already have a price", async () => {
    const p = await medicine();
    const o1 = await confirmed(p, 3);
    await db.query(`update public.products set selling_price = '125.50' where id = $1`, [p]);
    const o2 = await confirmed(p, 2); // took the price at confirm: it is not waiting
    const res = await dbPreview(db, a.userId, p, "125.50");
    expect(res.ok).toBe(true);
    expect(res.lines).toEqual([expect.objectContaining({ line_id: o1.lineIds[0], order_id: o1.id, order_number: o1.order.order_number, store_name: "Alpha Store", quantity: 3, line_total: "376.50" })]);
    expect(res.untouched_priced_lines).toBe(1);
    expect(res.total_waiting).toBe(1);
    expect(res.batch_limit).toBe(1000);
    expect(res.lines!.map((l) => l.line_id)).not.toContain(o2.lineIds[0]);
  });

  it("never lists draft, cancelled, removed or typed lines", async () => {
    const p = await medicine();
    const live = await confirmed(p, 1);
    const draft = await createPendingOrder(db, a.userId, storeA, [catalogLine(p, 4, "strip")]);
    const cancelled = await confirmed(p, 5);
    expect((await dbCancel(db, a.userId, cancelled.id, cancelled.order.version, "test")).cancelled).toBe(true);
    const removed = await confirmed(p, 6);
    await db.query(`update public.order_lines set removed_at = now() where id = $1`, [removed.lineIds[0]]);
    await createPendingOrder(db, a.userId, storeA, [typedLine(`Fill ${counter}`, 7, "strip")], { confirm: true });
    const res = await dbPreview(db, a.userId, p, "10");
    expect(res.lines!.map((l) => l.line_id)).toEqual(live.lineIds);
    expect(res.lines!.map((l) => l.line_id)).not.toContain(draft.lineIds[0]);
  });

  it("refuses bad prices, a medicine with a different price, an inactive or foreign medicine, and writes nothing", async () => {
    const p = await medicine();
    for (const price of ["0", "0.00", "-5", "12.345", "1e3", "abc", "", " ", "99999999999"]) {
      expect((await dbPreview(db, a.userId, p, price)).reason, price).toBe("invalid_price");
    }
    const priced = await medicine({ selling_price: "10.00" });
    const differs = await dbPreview(db, a.userId, priced, "12");
    expect(differs).toMatchObject({ ok: false, reason: "price_differs", current_price: "10.00" });
    expect((await dbPreview(db, a.userId, priced, "10")).ok).toBe(true);
    const inactive = await medicine({ is_active: false });
    expect((await dbPreview(db, a.userId, inactive, "10")).reason).toBe("product_inactive");
    const foreign = await insertMedicine(db, b.businessId, { name: "Foreign", unit: "strip" });
    expect((await dbPreview(db, a.userId, foreign, "10")).reason).toBe("product_not_found");
  });
});

describe("apply", () => {
  it("fills exactly the reviewed lines, leaves a priced line byte for byte the same, and sets the catalog price once", async () => {
    const p = await medicine({ purchase_price: "77.77", mrp: "88.88" });
    const o1 = await confirmed(p, 3);
    const o3 = await confirmed(p, 4, storeA);
    await db.query(`update public.products set selling_price = '125.50' where id = $1`, [p]);
    const o2 = await confirmed(p, 2); // already priced
    const before = await row(o2.lineIds[0]);
    const review = await dbPreview(db, a.userId, p, "125.50");
    const res = await dbPriceApplyRaw(db, a.userId, p, "125.50", review.lines!.map((l) => l.line_id), true);
    expect(res).toMatchObject({ done: true, replayed: false, filled_count: 2, orders_touched: 2 });
    expect(res.filled!.map((l) => l.line_id).sort()).toEqual([o1.lineIds[0], o3.lineIds[0]].sort());

    for (const [o, qty, total] of [[o1, 3, "376.50"], [o3, 4, "502.00"]] as const) {
      const after = await refetch(db, a.userId, o.id);
      expect(after.lines[0]).toMatchObject({ price_basis: "snapshot", selling_price: "125.50", line_total: total, quantity: qty });
      expect(after.version).toBe(o.order.version + 1);
    }
    expect(await row(o2.lineIds[0])).toEqual(before); // nothing about the already priced line changed
    expect((await refetch(db, a.userId, o2.id)).version).toBe(o2.order.version);
    expect(JSON.stringify(res)).not.toMatch(/77\.77|88\.88|purchase|mrp/i);
    expect(await flagOff()).toBe(true);
  });

  it("sets the catalog price only when the medicine had none", async () => {
    const p = await medicine();
    await confirmed(p, 1);
    const res = await dbPreview(db, a.userId, p, "50");
    await dbPriceApplyRaw(db, a.userId, p, "50", res.lines!.map((l) => l.line_id), true);
    expect((await productRow(p)).selling_price).toBe("50.00");
  });

  it("refuses a different price for a medicine that has one, and changes nothing", async () => {
    const p = await medicine();
    const o = await confirmed(p, 2);
    await db.query(`update public.products set selling_price = '10.00' where id = $1`, [p]);
    const before = await totals();
    const res = await dbPriceApplyRaw(db, a.userId, p, "12.00", o.lineIds, true);
    expect(res).toMatchObject({ done: false, reason: "price_differs", current_price: "10.00" });
    expect(await totals()).toEqual(before);
    expect((await row(o.lineIds[0])).selling_price_snapshot).toBeNull();
    expect((await productRow(p)).selling_price).toBe("10.00");
    expect(await flagOff()).toBe(true);
  });

  it("fills the waiting lines of a medicine that already has its price when the price is the same", async () => {
    const p = await medicine();
    const o = await confirmed(p, 2);
    await db.query(`update public.products set selling_price = '10.00' where id = $1`, [p]);
    const res = await dbPriceApplyRaw(db, a.userId, p, "10", o.lineIds, true);
    expect(res).toMatchObject({ done: true, filled_count: 1 });
    expect((await row(o.lineIds[0])).selling_price_snapshot).toBe("10.00");
  });

  it("refuses prices that are zero, negative, have more than two decimals or are too large", async () => {
    const p = await medicine();
    const o = await confirmed(p, 1);
    const before = await totals();
    for (const price of ["0", "-1", "12.345", "99999999999", "x"]) {
      expect((await dbPriceApplyRaw(db, a.userId, p, price, o.lineIds, true)).reason, price).toBe("invalid_price");
    }
    expect(await totals()).toEqual(before);
    expect((await row(o.lineIds[0])).selling_price_snapshot).toBeNull();
  });

  it("returns list_changed with the current lines when the waiting set changed after the review, and changes nothing", async () => {
    const p = await medicine();
    const o1 = await confirmed(p, 1);
    const o2 = await confirmed(p, 2);
    const review = await dbPreview(db, a.userId, p, "20");
    const ids = review.lines!.map((l) => l.line_id);
    expect(ids).toEqual([o1.lineIds[0], o2.lineIds[0]]);
    // the second order is cancelled after the review
    expect((await dbCancel(db, a.userId, o2.id, o2.order.version, "test")).cancelled).toBe(true);
    const before = await totals();
    const res = await dbPriceApplyRaw(db, a.userId, p, "20", ids, true);
    expect(res.reason).toBe("list_changed");
    expect(res.current_lines!.map((l) => l.line_id)).toEqual([o1.lineIds[0]]);
    expect(await totals()).toEqual(before);
    expect((await row(o1.lineIds[0])).selling_price_snapshot).toBeNull();
    expect((await productRow(p)).selling_price).toBeNull();

    // a line that got a price meanwhile (and is in the id list) is never overwritten: the list is refused instead
    await db.query(`select set_config('app.line_snapshot_edit', 'on', false)`);
    await db.query(`update public.order_lines set selling_price_snapshot = 99 where id = $1`, [o1.lineIds[0]]);
    await db.query(`select set_config('app.line_snapshot_edit', 'off', false)`);
    const again = await dbPriceApplyRaw(db, a.userId, p, "20", ids.slice(0, 1), true);
    expect(again.reason).toBe("list_changed");
    expect((await row(o1.lineIds[0])).selling_price_snapshot).toBe("99.00");
  });

  it("returns the stored result on a repeat and changes nothing the second time", async () => {
    const p = await medicine();
    const o = await confirmed(p, 3);
    const requestId = randomUUID();
    const first = await dbPriceApply(db, a.userId, p, { request_id: requestId, price: "30", line_ids: o.lineIds, fill_lines: true });
    expect(first).toMatchObject({ done: true, replayed: false, filled_count: 1 });
    const mid = await totals();
    const version = (await refetch(db, a.userId, o.id)).version;
    const again = await dbPriceApply(db, a.userId, p, { request_id: requestId, price: "30", line_ids: o.lineIds, fill_lines: true });
    expect(again).toMatchObject({ done: true, replayed: true, filled_count: 1 });
    expect(await totals()).toEqual(mid);
    expect((await refetch(db, a.userId, o.id)).version).toBe(version);
    expect(await eventsOf(o.id)).toHaveLength(1);
  });

  it("records one price_filled event per touched order with the old price none, the new price and the quantity", async () => {
    const p = await medicine();
    const o1 = await createPendingOrder(db, a.userId, storeA, [catalogLine(p, 3, "strip"), catalogLine(p, 5, "box")], { confirm: true });
    const o2 = await confirmed(p, 4);
    const review = await dbPreview(db, a.userId, p, "125.50");
    await dbPriceApplyRaw(db, a.userId, p, "125.50", review.lines!.map((l) => l.line_id), true);
    const e1 = await eventsOf(o1.id);
    expect(e1).toHaveLength(1);
    expect(e1[0].order_version).toBe(o1.order.version + 1);
    expect(e1[0].actor).toBe(a.userId);
    expect(e1[0].detail.price_filled).toEqual([
      { line_id: o1.lineIds[0], product_id: p, quantity: 3, previous_price: null, new_price: "125.50" },
      { line_id: o1.lineIds[1], product_id: p, quantity: 5, previous_price: null, new_price: "125.50" },
    ]);
    const e2 = await eventsOf(o2.id);
    expect(e2).toHaveLength(1);
    expect(e2[0].detail.price_filled).toEqual([{ line_id: o2.lineIds[0], product_id: p, quantity: 4, previous_price: null, new_price: "125.50" }]);
    expect(JSON.stringify([e1, e2])).not.toMatch(/purchase|mrp/i);
  });

  it("with fill_lines = false saves only the catalog price and leaves the lines waiting; a list with it is refused", async () => {
    const p = await medicine();
    const o = await confirmed(p, 3);
    const refused = await dbPriceApplyRaw(db, a.userId, p, "40", o.lineIds, false);
    expect(refused).toMatchObject({ done: false, reason: "invalid_request" });
    expect((await productRow(p)).selling_price).toBeNull();

    const saved = await dbPriceApplyRaw(db, a.userId, p, "40", [], false);
    expect(saved).toMatchObject({ done: true, filled_count: 0, orders_touched: 0 });
    expect((await productRow(p)).selling_price).toBe("40.00");
    expect((await row(o.lineIds[0])).selling_price_snapshot).toBeNull(); // still waiting
    expect((await refetch(db, a.userId, o.id)).version).toBe(o.order.version);
    expect(await eventsOf(o.id)).toHaveLength(0);
    // the medicine now shows its price, and the waiting lines can be filled at that price
    const fill = await dbPriceApplyRaw(db, a.userId, p, "40", o.lineIds, true);
    expect(fill).toMatchObject({ done: true, filled_count: 1 });
  });

  it("is all or nothing: a failure on the second line rolls back every line, the catalog price and the events", async () => {
    const p = await medicine();
    const o1 = await confirmed(p, 3);
    const o2 = await confirmed(p, 77); // the injected failure fires on this line
    await db.exec(`
      create function public.test_boom() returns trigger language plpgsql as $$
      begin
        if new.quantity = 77 and new.selling_price_snapshot is not null and old.selling_price_snapshot is null then
          raise exception 'injected failure';
        end if;
        return new;
      end $$;
      create trigger test_boom_trg before update on public.order_lines for each row execute function public.test_boom();
    `);
    try {
      const before = await totals();
      await expect(dbPriceApplyRaw(db, a.userId, p, "55", [o1.lineIds[0], o2.lineIds[0]], true)).rejects.toThrow(/injected failure/);
      expect((await row(o1.lineIds[0])).selling_price_snapshot).toBeNull();
      expect((await row(o2.lineIds[0])).selling_price_snapshot).toBeNull();
      expect((await productRow(p)).selling_price).toBeNull();
      expect(await totals()).toEqual(before);
      expect((await refetch(db, a.userId, o1.id)).version).toBe(o1.order.version);
      expect(await flagOff()).toBe(true);
    } finally {
      await db.exec(`drop trigger test_boom_trg on public.order_lines; drop function public.test_boom();`);
    }
    // once the failure is gone the same fill works
    const ok = await dbPriceApplyRaw(db, a.userId, p, "55", [o1.lineIds[0], o2.lineIds[0]], true);
    expect(ok).toMatchObject({ done: true, filled_count: 2 });
  });

  it("covers the first 1,000 waiting lines (oldest orders first); a second apply fills the remaining one", async () => {
    const p = await medicine();
    const orders: Awaited<ReturnType<typeof createPendingOrder>>[] = [];
    for (let i = 0; i < 6; i += 1) {
      const lines = Array.from({ length: i === 5 ? 1 : 200 }, () => catalogLine(p, 1, "strip"));
      orders.push(await createPendingOrder(db, a.userId, storeA, lines, { confirm: true }));
    }
    const review = await dbPreview(db, a.userId, p, "5");
    expect(review.total_waiting).toBe(1001);
    expect(review.lines).toHaveLength(1000);
    expect(review.lines!.some((l) => l.order_id === orders[5].id)).toBe(false); // the newest order is last in line

    const first = await dbPriceApplyRaw(db, a.userId, p, "5", review.lines!.map((l) => l.line_id), true);
    expect(first).toMatchObject({ done: true, filled_count: 1000, orders_touched: 5 });
    const left = await dbPreview(db, a.userId, p, "5");
    expect(left.total_waiting).toBe(1);
    expect(left.lines!.map((l) => l.line_id)).toEqual(orders[5].lineIds);
    const second = await dbPriceApplyRaw(db, a.userId, p, "5", left.lines!.map((l) => l.line_id), true);
    expect(second).toMatchObject({ done: true, filled_count: 1, orders_touched: 1 });
    expect((await dbPreview(db, a.userId, p, "5")).total_waiting).toBe(0);
  }, 240_000);

  it("never touches draft, cancelled or typed lines and never another business's lines", async () => {
    const p = await medicine();
    const live = await confirmed(p, 1);
    const draft = await createPendingOrder(db, a.userId, storeA, [catalogLine(p, 2, "strip")]);
    const cancelled = await confirmed(p, 3);
    await dbCancel(db, a.userId, cancelled.id, cancelled.order.version, "test");
    const foreignProduct = await insertMedicine(db, b.businessId, { name: "Foreign Filled", unit: "strip" });
    const foreignOrder = await createPendingOrder(db, b.userId, storeB, [catalogLine(foreignProduct, 1, "strip")], { confirm: true });

    const res = await dbPriceApplyRaw(db, a.userId, p, "9", live.lineIds, true);
    expect(res).toMatchObject({ done: true, filled_count: 1 });
    expect((await row(draft.lineIds[0])).selling_price_snapshot).toBeNull();
    expect((await row(cancelled.lineIds[0])).selling_price_snapshot).toBeNull();
    expect((await row(foreignOrder.lineIds[0])).selling_price_snapshot).toBeNull();
    // the other business cannot use this medicine, nor fill with it
    expect((await dbPriceApplyRaw(db, b.userId, p, "9", [], false)).reason).toBe("product_not_found");
    expect((await productRow(p)).selling_price).toBe("9.00");
  });

  it("refuses an inactive medicine and an incomplete request, and the flag is off afterwards", async () => {
    const inactive = await medicine({ is_active: false });
    expect((await dbPriceApplyRaw(db, a.userId, inactive, "9", [], false)).reason).toBe("product_inactive");
    const p = await medicine();
    const res = await dbPriceApply(db, a.userId, p, { request_id: randomUUID(), price: "9", line_ids: [], fill_lines: null as unknown as boolean });
    expect(res.reason).toBe("invalid_request");
    expect(await flagOff()).toBe(true);
  });
});
