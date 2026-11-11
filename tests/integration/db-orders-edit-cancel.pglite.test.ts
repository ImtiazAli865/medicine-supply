import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogLine, savePayload, seedWithDb, typedLine, type Seeded } from "../helpers/orders";
import { createDraft, dbCancel, dbConfirm, dbGet, dbSave } from "../helpers/orders-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// Editing a confirmed order in place, its change history, and cancelling.

let db: PGlite;
let a: Tenant;
let seedA: Seeded;

async function confirmed(lines: ReturnType<typeof catalogLine>[], notes: string | null = null) {
  const { id, order } = await createDraft(db, a.userId, seedA.storeId, lines, notes);
  const res = await dbConfirm(db, a.userId, id, order.version);
  return { id, order: res.order! };
}

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
  seedA = await seedWithDb(db, a.businessId);
});
afterAll(async () => {
  await db.close();
});

describe("editing a confirmed order", () => {
  it("changes a quantity: the snapshot stays, the line total follows, delivered quantity follows, one edited event with before and after", async () => {
    const { id, order } = await confirmed([catalogLine(seedA.pricedId, 3)]);
    const line = order.lines[0];
    await db.query(`update public.products set selling_price = '200.00' where id = $1`, [seedA.pricedId]); // must not leak into the edit
    try {
      const res = await dbSave(db, a.userId, id, savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId, 4), id: line.id }], { expected_version: order.version }));
      expect(res).toMatchObject({ saved: true });
      expect(res.order).toMatchObject({ status: "confirmed", version: order.version + 1 });
      expect(res.order!.lines[0]).toMatchObject({ quantity: 4, price_basis: "snapshot", selling_price: "125.50", line_total: "502.00", delivered_quantity: 4 });
      const edited = res.order!.events[0];
      expect(edited).toMatchObject({ event_type: "edited", order_version: order.version + 1 });
      expect(edited.detail).toEqual({ edited: { changes: [{ type: "quantity", line_id: line.id, name: "Panadol 500mg", from: 3, to: 4 }] } });
    } finally {
      await db.query(`update public.products set selling_price = '125.50' where id = $1`, [seedA.pricedId]);
    }
  });

  it("records a unit change and a notes change", async () => {
    const { id, order } = await confirmed([catalogLine(seedA.pricedId, 1, "strip")], "old note");
    const res = await dbSave(db, a.userId, id, savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId, 1, "box"), id: order.lines[0].id }], { expected_version: order.version, notes: "new note" }));
    const changes = (res.order!.events[0].detail as { edited: { changes: Array<Record<string, unknown>> } }).edited.changes;
    expect(changes).toEqual([
      { type: "unit", line_id: order.lines[0].id, name: "Panadol 500mg", from: "strip", to: "box" },
      { type: "notes", from: "old note", to: "new note" },
    ]);
  });

  it("gives a line added during the edit its own snapshot at that save, never changed later", async () => {
    const { id, order } = await confirmed([catalogLine(seedA.pricedId, 1)]);
    const added = catalogLine(seedA.sellingOnlyId, 2, "box");
    const res = await dbSave(db, a.userId, id, savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId, 1), id: order.lines[0].id }, added], { expected_version: order.version }));
    expect(res.order!.lines[1]).toMatchObject({ name: "Brufen 400mg", price_basis: "snapshot", selling_price: "310.00", line_total: "620.00", delivered_quantity: 2 });
    await db.query(`update public.products set selling_price = '999.00' where id = $1`, [seedA.sellingOnlyId]);
    try {
      expect((await dbGet(db, a.userId, id))!.lines[1]).toMatchObject({ selling_price: "310.00", line_total: "620.00" });
    } finally {
      await db.query(`update public.products set selling_price = '310.00' where id = $1`, [seedA.sellingOnlyId]);
    }
    const detail = (res.order!.events[0].detail as { edited: { changes: Array<Record<string, unknown>> } }).edited.changes;
    expect(detail).toEqual([{ type: "added", line_id: added.id, name: "Brufen 400mg", quantity: 2, unit: "box", selling_price: "310.00" }]);
  });

  it("removes a line without deleting it, and records the removed line with its selling price (never purchase price or MRP)", async () => {
    const { id, order } = await confirmed([catalogLine(seedA.pricedId, 2), typedLine("Typed Item", 1, "box")]);
    const [priced] = order.lines;
    const res = await dbSave(db, a.userId, id, savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId, 2), id: priced.id }], { expected_version: order.version }));
    expect(res.order!.lines).toHaveLength(1);
    const removedRow = await db.query<{ removed_at: string | null }>(`select removed_at from public.order_lines where id = $1`, [order.lines[1].id]);
    expect(removedRow.rows[0].removed_at).not.toBeNull();
    const detail = (res.order!.events[0].detail as { edited: { changes: Array<Record<string, unknown>> } }).edited.changes;
    expect(detail).toEqual([{ type: "removed", line_id: order.lines[1].id, name: "Typed Item", quantity: 1, unit: "box", selling_price: null }]);
    expect(JSON.stringify(res.order!.events)).not.toMatch(/purchase|mrp/i);
  });

  it("writes no event for a save that changes nothing, but keeps the order confirmed", async () => {
    const { id, order } = await confirmed([catalogLine(seedA.pricedId, 2)]);
    const res = await dbSave(db, a.userId, id, savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId, 2), id: order.lines[0].id }], { expected_version: order.version }));
    expect(res).toMatchObject({ saved: true });
    expect(res.order!.status).toBe("confirmed");
    expect(res.order!.events.map((e) => e.event_type)).toEqual(["confirmed", "created"]);
  });

  it("refuses a stale version with the current order, and replays the same request id", async () => {
    const { id, order } = await confirmed([catalogLine(seedA.pricedId, 2)]);
    const payload = savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId, 5), id: order.lines[0].id }], { expected_version: order.version });
    const first = await dbSave(db, a.userId, id, payload);
    expect(await dbSave(db, a.userId, id, payload)).toMatchObject({ saved: true, replayed: true });
    const stale = await dbSave(db, a.userId, id, savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId, 9), id: order.lines[0].id }], { expected_version: order.version }));
    expect(stale).toMatchObject({ saved: false, reason: "version_conflict" });
    expect(stale.current!.lines[0].quantity).toBe(5);
    expect(stale.current!.version).toBe(first.order!.version);
  });

  it("leaves lines, snapshots, version and events exactly as before when a save fails part-way", async () => {
    const { id, order } = await confirmed([catalogLine(seedA.pricedId, 2)]);
    await db.exec(`
      create or replace function public.test_fail_on_name() returns trigger language plpgsql as $$
      begin if new.name = 'FAIL' then raise exception 'induced failure'; end if; return new; end $$;
      create trigger test_fail before insert on public.order_lines for each row execute function public.test_fail_on_name();
    `);
    try {
      const payload = savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId, 40), id: order.lines[0].id }, typedLine("FAIL")], { expected_version: order.version, notes: "changed" });
      await expect(dbSave(db, a.userId, id, payload)).rejects.toThrow(/induced failure/);
    } finally {
      await db.exec(`drop trigger if exists test_fail on public.order_lines; drop function if exists public.test_fail_on_name();`);
    }
    const after = (await dbGet(db, a.userId, id))!;
    expect(after).toMatchObject({ version: order.version, notes: null, status: "confirmed" });
    expect(after.lines).toEqual(order.lines);
    expect(after.events).toHaveLength(2);
  });
});

describe("cancelling", () => {
  it("needs a reason for a confirmed order and keeps its lines and snapshots", async () => {
    const { id, order } = await confirmed([catalogLine(seedA.pricedId, 2)]);
    expect(await dbCancel(db, a.userId, id, order.version, null)).toEqual({ cancelled: false, reason: "reason_required" });
    expect(await dbCancel(db, a.userId, id, order.version, "   ")).toEqual({ cancelled: false, reason: "reason_required" });
    expect(await dbCancel(db, a.userId, id, order.version, "x".repeat(501))).toEqual({ cancelled: false, reason: "reason_too_long" });
    expect((await dbGet(db, a.userId, id))!.status).toBe("confirmed");

    const res = await dbCancel(db, a.userId, id, order.version, "  Pharmacy cancelled by phone ");
    expect(res).toMatchObject({ cancelled: true, replayed: false });
    expect(res.order).toMatchObject({ status: "cancelled", cancel_reason: "Pharmacy cancelled by phone" });
    expect(res.order!.cancelled_at).toBeTruthy();
    expect(res.order!.lines).toEqual(order.lines); // lines and snapshots untouched
    expect(res.order!.events[0]).toMatchObject({ event_type: "cancelled" });
    expect(res.order!.events[0].detail).toEqual({ cancelled: { from_status: "confirmed", reason: "Pharmacy cancelled by phone" } });
  });

  it("is final: a cancelled order cannot be saved, confirmed or cancelled again, and a repeat returns the original", async () => {
    const { id, order } = await confirmed([catalogLine(seedA.pricedId, 2)]);
    const res = await dbCancel(db, a.userId, id, order.version, "Duplicate order");
    const line = order.lines[0];
    expect(await dbSave(db, a.userId, id, savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId, 1), id: line.id }], { expected_version: res.order!.version }))).toMatchObject({ saved: false, reason: "order_not_editable" });
    expect(await dbConfirm(db, a.userId, id, res.order!.version)).toMatchObject({ confirmed: false, reason: "order_not_editable" });
    const again = await dbCancel(db, a.userId, id, order.version, "A different reason");
    expect(again).toMatchObject({ cancelled: true, replayed: true });
    expect(again.order!.cancel_reason).toBe("Duplicate order");
  });

  it("refuses a cancellation based on an older version", async () => {
    const { id, order } = await confirmed([catalogLine(seedA.pricedId, 2)]);
    await dbSave(db, a.userId, id, savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId, 3), id: order.lines[0].id }], { expected_version: order.version }));
    expect(await dbCancel(db, a.userId, id, order.version, "late")).toMatchObject({ cancelled: false, reason: "version_conflict" });
  });
});

describe("history", () => {
  it("can never be edited or deleted by the table owner or a signed-in user", async () => {
    const { id } = await confirmed([catalogLine(seedA.pricedId, 1)]);
    await expect(db.query(`update public.order_events set detail = '{}'::jsonb where order_id = $1`, [id])).rejects.toThrow(/order_events_append_only/);
    await expect(db.query(`delete from public.order_events where order_id = $1`, [id])).rejects.toThrow(/order_events_append_only/);
  });

  it("never deletes orders or lines through any function", async () => {
    const orders = Number((await db.query<{ n: number }>(`select count(*)::int as n from public.orders`)).rows[0].n);
    const { id, order } = await confirmed([catalogLine(seedA.pricedId, 1)]);
    await dbCancel(db, a.userId, id, order.version, "gone");
    const after = Number((await db.query<{ n: number }>(`select count(*)::int as n from public.orders`)).rows[0].n);
    expect(after).toBe(orders + 1);
    expect(await dbGet(db, a.userId, randomUUID())).toBeNull();
  });
});
