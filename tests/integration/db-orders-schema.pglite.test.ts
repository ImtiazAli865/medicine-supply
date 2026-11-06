import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";
import { seedWithDb, type Seeded } from "../helpers/orders";

// Schema, constraints, triggers and privileges of migration 0003 (orders), on a real PostgreSQL
// engine (PGlite) with a Supabase-like role setup. Rows are inserted as the table owner here, which
// bypasses Row Level Security, so these tests exercise the constraints and triggers themselves.

let db: PGlite;
let a: Tenant;
let b: Tenant;
let seedA: Seeded;
let seedB: Seeded;

const asA = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", a.userId, fn);

async function insertOrder(over: Record<string, unknown> = {}): Promise<string> {
  const id = (over.id as string | undefined) ?? randomUUID();
  const row = {
    business_id: a.businessId,
    store_id: seedA.storeId,
    order_number: Math.floor(Math.random() * 1_000_000) + 1,
    ...over,
    id,
  };
  const cols = Object.keys(row);
  await db.query(
    `insert into public.orders (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    cols.map((c) => (row as Record<string, unknown>)[c]),
  );
  return id;
}

async function insertLine(orderId: string, over: Record<string, unknown> = {}): Promise<string> {
  const id = (over.id as string | undefined) ?? randomUUID();
  const row = {
    business_id: a.businessId,
    order_id: orderId,
    position: 1,
    product_id: seedA.pricedId,
    item_status: "registered",
    name: "Panadol 500mg",
    quantity: 3,
    unit: "strip",
    ...over,
    id,
  };
  const cols = Object.keys(row);
  await db.query(
    `insert into public.order_lines (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    cols.map((c) => (row as Record<string, unknown>)[c]),
  );
  return id;
}

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

describe("tables, privileges and Row Level Security", () => {
  it("has Row Level Security on all four new tables", async () => {
    const res = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relname in ('order_counters','orders','order_lines','order_events') and relkind = 'r' order by relname`,
    );
    expect(res.rows.map((r) => r.relname)).toEqual(["order_counters", "order_events", "order_lines", "orders"]);
    for (const row of res.rows) expect(row.relrowsecurity, row.relname).toBe(true);
  });

  it("gives signed-in users SELECT only on orders, lines and events, and nothing on the counter", async () => {
    for (const table of ["orders", "order_lines", "order_events"]) {
      const res = await db.query<{ s: boolean; i: boolean; u: boolean; d: boolean }>(
        `select has_table_privilege('authenticated', 'public.${table}', 'select') s,
                has_table_privilege('authenticated', 'public.${table}', 'insert') i,
                has_table_privilege('authenticated', 'public.${table}', 'update') u,
                has_table_privilege('authenticated', 'public.${table}', 'delete') d`,
      );
      expect(res.rows[0], table).toEqual({ s: true, i: false, u: false, d: false });
    }
    const counter = await db.query<{ any: boolean }>(
      `select has_any_column_privilege('authenticated', 'public.order_counters', 'select, insert, update') as any`,
    );
    expect(counter.rows[0].any).toBe(false);
  });

  it("gives the signed-out role nothing on any of them", async () => {
    for (const table of ["orders", "order_lines", "order_events", "order_counters"]) {
      const res = await db.query<{ any: boolean }>(
        `select has_any_column_privilege('anon', 'public.${table}', 'select, insert, update') as any`,
      );
      expect(res.rows[0].any, table).toBe(false);
    }
  });

  it("refuses direct inserts, updates and deletes by a signed-in user", async () => {
    const id = await insertOrder();
    await expect(
      asA(() => db.query(`insert into public.orders (id, store_id, order_number) values ($1, $2, 999)`, [randomUUID(), seedA.storeId])),
    ).rejects.toThrow(/permission denied/i);
    await expect(asA(() => db.query(`update public.orders set notes = 'x' where id = $1`, [id]))).rejects.toThrow(/permission denied/i);
    await expect(asA(() => db.query(`delete from public.orders where id = $1`, [id]))).rejects.toThrow(/permission denied/i);
    await expect(asA(() => db.query(`select * from public.order_counters`))).rejects.toThrow(/permission denied/i);
  });

  it("adds unique (business_id, id) to stores and products so references can be tied to one business", async () => {
    const res = await db.query<{ conname: string }>(
      `select conname from pg_constraint where conname in ('stores_business_id_id_uniq','products_business_id_id_uniq')`,
    );
    expect(res.rows.map((r) => r.conname).sort()).toEqual(["products_business_id_id_uniq", "stores_business_id_id_uniq"]);
  });
});

describe("constraints", () => {
  it("refuses an order whose store belongs to another business", async () => {
    await expect(insertOrder({ store_id: seedB.storeId })).rejects.toThrow(/foreign key|violates/i);
  });

  it("refuses a line whose medicine belongs to another business", async () => {
    const order = await insertOrder();
    await expect(insertLine(order, { product_id: seedB.pricedId })).rejects.toThrow(/foreign key|violates/i);
  });

  it("refuses a line in an order of another business", async () => {
    const orderB = await insertOrder({ business_id: b.businessId, store_id: seedB.storeId });
    await expect(insertLine(orderB, { business_id: a.businessId })).rejects.toThrow(/foreign key|violates/i);
  });

  it("refuses duplicate order numbers inside one business but allows the same number in another", async () => {
    await insertOrder({ order_number: 5001 });
    await expect(insertOrder({ order_number: 5001 })).rejects.toThrow(/unique|duplicate/i);
    await insertOrder({ business_id: b.businessId, store_id: seedB.storeId, order_number: 5001 });
  });

  it("checks status, source, order number, notes and cancel reason", async () => {
    await expect(insertOrder({ status: "shipped" })).rejects.toThrow(/check/i);
    await expect(insertOrder({ source: "fax" })).rejects.toThrow(/check/i);
    await expect(insertOrder({ order_number: 0 })).rejects.toThrow(/check/i);
    await expect(insertOrder({ notes: "x".repeat(1001) })).rejects.toThrow(/check/i);
    await expect(insertOrder({ cancel_reason: "x".repeat(501) })).rejects.toThrow(/check/i);
  });

  it("requires cancelled_at for a cancelled order and a reason when a confirmed order was cancelled", async () => {
    await expect(insertOrder({ status: "cancelled" })).rejects.toThrow(/check/i);
    await expect(insertOrder({ status: "cancelled", cancelled_at: new Date(), confirmed_at: new Date() })).rejects.toThrow(/check/i);
    await expect(
      insertOrder({ status: "cancelled", cancelled_at: new Date(), confirmed_at: new Date(), cancel_reason: "   " }),
    ).rejects.toThrow(/check/i);
    await insertOrder({ status: "cancelled", cancelled_at: new Date() }); // a discarded draft needs no reason
    await insertOrder({ status: "cancelled", cancelled_at: new Date(), confirmed_at: new Date(), cancel_reason: "Pharmacy cancelled" });
    await expect(insertOrder({ status: "confirmed" })).rejects.toThrow(/check/i);
  });

  it("checks quantity 1..100000, a non-empty unit and the registered/typed consistency of a line", async () => {
    const order = await insertOrder();
    await expect(insertLine(order, { quantity: 0 })).rejects.toThrow(/check/i);
    await expect(insertLine(order, { quantity: 100001 })).rejects.toThrow(/check/i);
    await insertLine(order, { quantity: 100000 });
    await expect(insertLine(order, { unit: "  " })).rejects.toThrow(/check/i);
    await expect(insertLine(order, { product_id: null, item_status: "registered" })).rejects.toThrow(/check/i);
    await expect(insertLine(order, { product_id: seedA.pricedId, item_status: "pending_registration" })).rejects.toThrow(/check/i);
    await insertLine(order, { product_id: null, item_status: "pending_registration", name: "Some Unknown Syrup" });
  });

  it("refuses a price without a snapshot time", async () => {
    const order = await insertOrder();
    await expect(insertLine(order, { selling_price_snapshot: "10.00" })).rejects.toThrow(/check/i);
    await insertLine(order, { selling_price_snapshot: "10.00", snapshot_taken_at: new Date() });
  });

  it("computes line_total exactly as quantity x selling price snapshot, and leaves it empty without a price", async () => {
    const order = await insertOrder();
    const priced = await insertLine(order, { quantity: 3, selling_price_snapshot: "125.50", snapshot_taken_at: new Date() });
    const unpriced = await insertLine(order, { quantity: 3, snapshot_taken_at: new Date() });
    const rows = await db.query<{ id: string; line_total: string | null }>(
      `select id, line_total::text from public.order_lines where id in ($1, $2)`,
      [priced, unpriced],
    );
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r.line_total]));
    expect(byId[priced]).toBe("376.50");
    expect(byId[unpriced]).toBeNull();
  });
});

describe("triggers", () => {
  it("bumps the order version on every update", async () => {
    const id = await insertOrder();
    const first = await db.query<{ version: number }>(`select version from public.orders where id = $1`, [id]);
    expect(first.rows[0].version).toBe(1);
    await db.query(`update public.orders set notes = 'a' where id = $1`, [id]);
    await db.query(`update public.orders set notes = 'b' where id = $1`, [id]);
    const after = await db.query<{ version: number }>(`select version from public.orders where id = $1`, [id]);
    expect(after.rows[0].version).toBe(3);
  });

  it("lets the store change only while a draft has no active line, keeps order number and source immutable, and allows only legal status moves", async () => {
    const id = await insertOrder();
    const other = randomUUID();
    await db.query(`insert into public.stores (id, business_id, name) values ($1, $2, 'Another store')`, [other, a.businessId]);

    // an empty draft may change store
    await db.query(`update public.orders set store_id = $1 where id = $2`, [other, id]);
    await db.query(`update public.orders set store_id = $1 where id = $2`, [seedA.storeId, id]);

    // once it has an active line the store is locked, and a removed line does not count
    const line = await insertLine(id);
    await expect(db.query(`update public.orders set store_id = $1 where id = $2`, [other, id])).rejects.toThrow(/immutable/i);
    await db.query(`update public.order_lines set removed_at = now() where id = $1`, [line]);
    await db.query(`update public.orders set store_id = $1 where id = $2`, [other, id]);
    await db.query(`update public.orders set store_id = $1 where id = $2`, [seedA.storeId, id]);

    await expect(db.query(`update public.orders set order_number = order_number + 1 where id = $1`, [id])).rejects.toThrow(/immutable/i);
    await expect(db.query(`update public.orders set source = 'voice' where id = $1`, [id])).rejects.toThrow(/immutable/i);

    // draft -> fulfilled is not allowed; draft -> confirmed -> cancelled is; cancelled is final
    await expect(db.query(`update public.orders set status = 'fulfilled' where id = $1`, [id])).rejects.toThrow(/status/i);
    await db.query(`update public.orders set status = 'confirmed', confirmed_at = now() where id = $1`, [id]);
    await expect(db.query(`update public.orders set status = 'draft' where id = $1`, [id])).rejects.toThrow(/status/i);
    await db.query(`update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'x' where id = $1`, [id]);
    await expect(db.query(`update public.orders set status = 'confirmed' where id = $1`, [id])).rejects.toThrow(/status/i);
  });

  it("freezes the snapshot and description of a line once the snapshot time is set", async () => {
    const order = await insertOrder();
    const line = await insertLine(order, {
      quantity: 2,
      selling_price_snapshot: "125.50",
      purchase_price_snapshot: "90.00",
      mrp_snapshot: "130.00",
      snapshot_taken_at: new Date(),
      strength: "500 mg",
    });
    for (const change of [
      `selling_price_snapshot = '1.00'`,
      `purchase_price_snapshot = null`,
      `mrp_snapshot = '1.00'`,
      `snapshot_taken_at = now() + interval '1 day'`,
      `name = 'Renamed'`,
      `strength = '1000 mg'`,
      `dosage_form = 'syrup'`,
      `pack_size = '20'`,
      `manufacturer = 'Other'`,
    ]) {
      await expect(db.query(`update public.order_lines set ${change} where id = $1`, [line]), change).rejects.toThrow(/snapshot_immutable/);
    }
    // quantity, unit, delivered quantity, position and removal may change; the line total follows the quantity
    await db.query(`update public.order_lines set quantity = 4, unit = 'box', delivered_quantity = 4, position = 2, removed_at = now() where id = $1`, [line]);
    const row = await db.query<{ line_total: string }>(`select line_total::text from public.order_lines where id = $1`, [line]);
    expect(row.rows[0].line_total).toBe("502.00");
  });

  it("lets a transaction that sets the reserved flag fill a missing snapshot price (the Module 004 hook), and nothing else does", async () => {
    const order = await insertOrder();
    const line = await insertLine(order, { snapshot_taken_at: new Date() });
    expect((await db.query<{ v: string | null }>(`select current_setting('app.line_snapshot_edit', true) as v`)).rows[0].v ?? "").not.toBe("on");
    await expect(db.query(`update public.order_lines set selling_price_snapshot = '50.00' where id = $1`, [line])).rejects.toThrow(/snapshot_immutable/);
    await db.exec("begin");
    try {
      await db.query(`select set_config('app.line_snapshot_edit', 'on', true)`);
      await db.query(`update public.order_lines set selling_price_snapshot = '50.00' where id = $1`, [line]);
      await db.exec("commit");
    } catch (error) {
      await db.exec("rollback");
      throw error;
    }
    const row = await db.query<{ selling_price_snapshot: string }>(`select selling_price_snapshot::text from public.order_lines where id = $1`, [line]);
    expect(row.rows[0].selling_price_snapshot).toBe("50.00");
  });

  it("makes order events append-only, even for the table owner, and lets only the service role delete them", async () => {
    const order = await insertOrder();
    const eventId = randomUUID();
    await db.query(
      `insert into public.order_events (id, business_id, order_id, event_type, order_version) values ($1, $2, $3, 'created', 1)`,
      [eventId, a.businessId, order],
    );
    await expect(db.query(`update public.order_events set order_version = 2 where id = $1`, [eventId])).rejects.toThrow(/order_events_append_only/);
    await expect(db.query(`delete from public.order_events where id = $1`, [eventId])).rejects.toThrow(/order_events_append_only/);
    await expect(db.query(`update public.order_events set event_type = 'cancelled'`)).rejects.toThrow(/order_events_append_only/);

    // Supabase gives the service role table privileges by default; PGlite does not, so grant them here.
    await db.exec(`grant select, delete on public.order_events to service_role`);
    await withRole(db, "service_role", null, async () => {
      await db.query(`delete from public.order_events where id = $1`, [eventId]);
    });
    const left = await db.query(`select 1 from public.order_events where id = $1`, [eventId]);
    expect(left.rows).toHaveLength(0);
  });

  it("knows the Pakistan time zone (used by the history date filters)", async () => {
    const res = await db.query<{ h: string }>(`select to_char(timestamptz '2026-01-01 00:00:00+00' at time zone 'Asia/Karachi', 'HH24') as h`);
    expect(res.rows[0].h).toBe("05");
  });
});
