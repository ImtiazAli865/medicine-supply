import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbCancel, dbConfirm, dbSave } from "../helpers/orders-db";
import { savePayload } from "../helpers/orders";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";
import { linkBody, priceBody, registerBody } from "../helpers/pending";
import { catalogLine, createPendingOrder, dbLink, dbPreview, dbPriceApply, dbRegister, insertMedicine, insertStore, refetch, typedLine } from "../helpers/pending-db";

// What stays true about an order's history after Module 004 changed it: the new events can not be rewritten, the
// typed text is kept for ever, and an editor that still holds the old typed line is told the order changed.

let db: PGlite;
let a: Tenant;
let storeA: string;
let counter = 0;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "hist");
  storeA = await insertStore(db, a.businessId, "History Store");
}, 60_000);

afterAll(async () => {
  await db.close();
});

const eventsOf = async (orderId: string, type: string) =>
  (await db.query<{ id: string; detail: unknown }>(`select id, detail from public.order_events where order_id = $1 and event_type = $2`, [orderId, type])).rows;
const lineRow = async (id: string) => (await db.query<Record<string, unknown>>(`select * from public.order_lines where id = $1`, [id])).rows[0];

/** An order with a linked event and a price_filled event. */
async function orderWithBothEvents() {
  counter += 1;
  const pricedLater = await insertMedicine(db, a.businessId, { name: `Hist Later ${counter}`, unit: "strip" });
  const o = await createPendingOrder(db, a.userId, storeA, [typedLine("hist later typed", 3, "strip"), catalogLine(pricedLater, 2, "strip")], { confirm: true });
  const linked = await dbLink(db, a.userId, o.id, o.lineIds[0], linkBody(o.order.version, pricedLater));
  expect(linked.done).toBe(true);
  const review = await dbPreview(db, a.userId, pricedLater, "30");
  const fill = await dbPriceApply(db, a.userId, pricedLater, priceBody("30", review.lines!.map((l) => l.line_id)));
  expect(fill.done).toBe(true);
  return { o, pricedLater };
}

describe("the new events can not be rewritten", () => {
  it("a signed-in user can neither update nor delete a linked or price_filled event", async () => {
    const { o } = await orderWithBothEvents();
    const events = [...(await eventsOf(o.id, "linked")), ...(await eventsOf(o.id, "price_filled"))];
    expect(events).toHaveLength(2);
    await withRole(db, "authenticated", a.userId, async () => {
      for (const e of events) {
        for (const sql of [`update public.order_events set detail = '{}'::jsonb where id = $1`, `update public.order_events set event_type = 'cancelled' where id = $1`, `delete from public.order_events where id = $1`]) {
          const outcome = await db.query(sql, [e.id]).then((r) => ({ rows: r.affectedRows ?? 0, error: null as string | null }), (err: Error) => ({ rows: 0, error: err.message }));
          expect(outcome.rows, sql).toBe(0); // nothing was changed, with an error or without
        }
      }
    });
    const after = [...(await eventsOf(o.id, "linked")), ...(await eventsOf(o.id, "price_filled"))];
    expect(after).toEqual(events);
  });

  it("not even the table owner can rewrite an event: the append-only guard raises", async () => {
    const { o } = await orderWithBothEvents();
    const [event] = await eventsOf(o.id, "price_filled");
    await expect(db.query(`update public.order_events set detail = '{}'::jsonb where id = $1`, [event.id])).rejects.toThrow();
    await expect(db.query(`delete from public.order_events where id = $1`, [event.id])).rejects.toThrow();
  });
});

describe("the typed text is kept", () => {
  it("typed_name is write-once: it survives later edits and a cancel, and can not be changed", async () => {
    const product = await insertMedicine(db, a.businessId, { name: "Hist Once", unit: "strip", selling_price: "10.00" });
    const o = await createPendingOrder(db, a.userId, storeA, [typedLine("hist once typed", 3, "strip"), catalogLine(product, 1, "box")], { confirm: true });
    const linked = await dbLink(db, a.userId, o.id, o.lineIds[0], linkBody(o.order.version, product));
    expect(linked.done).toBe(true);
    expect((await lineRow(o.lineIds[0])).typed_name).toBe("hist once typed");

    // the owner edits the confirmed order afterwards (same lines, another quantity)
    const version = (await refetch(db, a.userId, o.id)).version;
    const edit = await dbSave(db, a.userId, o.id, savePayload(storeA, [{ id: o.lineIds[0], product_id: product, name: null, quantity: 9, unit: "strip" }, { id: o.lineIds[1], product_id: product, name: null, quantity: 1, unit: "box" }], { expected_version: version }));
    expect(edit.saved).toBe(true);
    expect(await lineRow(o.lineIds[0])).toMatchObject({ typed_name: "hist once typed", quantity: 9 });

    await expect(db.query(`update public.order_lines set typed_name = 'something else' where id = $1`, [o.lineIds[0]])).rejects.toThrow();
    await expect(db.query(`update public.order_lines set typed_name = null where id = $1`, [o.lineIds[0]])).rejects.toThrow();

    const current = await refetch(db, a.userId, o.id);
    expect((await dbCancel(db, a.userId, o.id, current.version, "test")).cancelled).toBe(true);
    expect((await lineRow(o.lineIds[0])).typed_name).toBe("hist once typed");
    expect((await refetch(db, a.userId, o.id)).lines[0]).toMatchObject({ typed_name: "hist once typed" });
  });

  it("a confirmed typed line that was linked and priced still shows its typed text, the registered description and the filled price", async () => {
    const product = await insertMedicine(db, a.businessId, { name: "Hist Shown", unit: "strip", strength: "250 mg", dosage_form: "tablet" });
    const o = await createPendingOrder(db, a.userId, storeA, [typedLine("hist shown typed", 4, "strip")], { confirm: true });
    const linked = await dbLink(db, a.userId, o.id, o.lineIds[0], linkBody(o.order.version, product));
    expect(linked.done).toBe(true);
    const review = await dbPreview(db, a.userId, product, "12.50");
    expect((await dbPriceApply(db, a.userId, product, priceBody("12.50", review.lines!.map((l) => l.line_id)))).done).toBe(true);
    const order = await refetch(db, a.userId, o.id);
    expect(order.lines[0]).toMatchObject({
      typed_name: "hist shown typed", name: "Hist Shown", strength: "250 mg", dosage_form: "tablet", quantity: 4, unit: "strip",
      price_basis: "snapshot", selling_price: "12.50", line_total: "50.00",
    });
    expect(order.events.map((e) => e.event_type)).toEqual(expect.arrayContaining(["created", "confirmed", "linked", "price_filled"]));
  });

  it("registering keeps the typed text too, and a draft linked before it is confirmed takes its snapshot normally", async () => {
    const product = await insertMedicine(db, a.businessId, { name: "Hist Draft", unit: "strip", selling_price: "40.00" });
    const o = await createPendingOrder(db, a.userId, storeA, [typedLine("hist draft typed", 2, "strip"), typedLine("hist register typed", 1, "box")]);
    const linked = await dbLink(db, a.userId, o.id, o.lineIds[0], linkBody(o.order.version, product));
    expect(linked.done).toBe(true);
    const reg = await dbRegister(db, a.userId, o.id, o.lineIds[1], registerBody(linked.order!.version, { name: "Hist Register" }));
    expect(reg.done).toBe(true);
    const draft = await refetch(db, a.userId, o.id);
    expect(draft.lines[0]).toMatchObject({ typed_name: "hist draft typed", name: "Hist Draft", price_basis: "current" }); // a draft follows the current price
    expect(draft.lines[1]).toMatchObject({ typed_name: "hist register typed", name: "Hist Register" });

    const confirmed = await dbConfirm(db, a.userId, o.id, draft.version);
    expect(confirmed.confirmed).toBe(true);
    const order = await refetch(db, a.userId, o.id);
    expect(order.lines[0]).toMatchObject({ typed_name: "hist draft typed", name: "Hist Draft", price_basis: "snapshot", selling_price: "40.00", line_total: "80.00" });
    expect(order.lines[1]).toMatchObject({ typed_name: "hist register typed", name: "Hist Register", price_basis: "none", selling_price: null });
  });
});

describe("an editor that still holds the old typed line", () => {
  it("is told the order changed (version_conflict), never that its lines are invalid, and nothing is overwritten", async () => {
    const product = await insertMedicine(db, a.businessId, { name: "Hist Stale", unit: "strip" });
    const o = await createPendingOrder(db, a.userId, storeA, [typedLine("hist stale typed", 3, "strip")]);
    const linked = await dbLink(db, a.userId, o.id, o.lineIds[0], linkBody(o.order.version, product));
    expect(linked.done).toBe(true);
    // the other page still has the typed line and the old version
    const stale = await dbSave(db, a.userId, o.id, savePayload(storeA, [{ id: o.lineIds[0], product_id: null, name: "hist stale typed", quantity: 7, unit: "strip" }], { expected_version: o.order.version }));
    expect(stale.saved).toBe(false);
    expect(stale.reason).toBe("version_conflict");
    expect(stale.reason).not.toBe("invalid_lines");
    expect(await lineRow(o.lineIds[0])).toMatchObject({ product_id: product, quantity: 3, typed_name: "hist stale typed" });
  });
});
