import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbCancel } from "../helpers/orders-db";
import { catalogLine, seedWithDb, typedLine, type Seeded } from "../helpers/orders";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";
import { registerBody } from "../helpers/pending";
import { createPendingOrder, dbRegister, insertMedicine, refetch, type PendingOrder } from "../helpers/pending-db";

// Quick Register (pending_line_register) on a real PostgreSQL engine (PGlite): the medicine is created and the
// line is linked in one step, nothing else changes, and every refusal changes nothing.

let db: PGlite;
let a: Tenant;
let b: Tenant;
let seedA: Seeded;
let seedB: Seeded;

interface Fixture extends PendingOrder {
  typedId: string;
  otherId: string;
}

/** An order with one typed line and one catalog line, optionally confirmed. */
async function fixture(confirm: boolean, typedName = "Noran 20mg cap"): Promise<Fixture> {
  const o = await createPendingOrder(db, a.userId, seedA.storeId, [typedLine(typedName, 3, "strip"), catalogLine(seedA.sellingOnlyId, 2, "box")], { confirm });
  return { ...o, typedId: o.order.lines[0].id, otherId: o.order.lines[1].id };
}

const countProducts = async () => Number((await db.query<{ n: number }>(`select count(*)::int as n from public.products where business_id = $1`, [a.businessId])).rows[0].n);
const lineRow = async (id: string) => (await db.query<Record<string, unknown>>(`select * from public.order_lines where id = $1`, [id])).rows[0];
const eventsOf = async (orderId: string, type: string) =>
  (await db.query<{ detail: Record<string, unknown>; order_version: number }>(`select detail, order_version from public.order_events where order_id = $1 and event_type = $2 order by created_at`, [orderId, type])).rows;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
  b = await createTenant(db, "b");
  seedA = await seedWithDb(db, a.businessId);
  seedB = await seedWithDb(db, b.businessId);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("registering with only a name and a unit", () => {
  it("creates the medicine with every other field empty and links the line, changing nothing else", async () => {
    const f = await fixture(false);
    const before = await countProducts();
    const body = registerBody(f.order.version);
    const res = await dbRegister(db, a.userId, f.id, f.typedId, body);
    expect(res.done).toBe(true);
    expect(res.replayed).toBe(false);
    expect(res.price_applied).toBe(false);
    expect(await countProducts()).toBe(before + 1);

    const product = (await db.query<Record<string, unknown>>(`select * from public.products where id = $1`, [body.product.id])).rows[0];
    expect(product).toMatchObject({ name: "Noran 20mg cap", unit: "strip", business_id: a.businessId, is_active: true });
    for (const field of ["brand", "generic_name", "strength", "dosage_form", "manufacturer", "pack_size", "sku", "purchase_price", "selling_price", "mrp"]) {
      expect(product[field], field).toBeNull();
    }

    const typed = await lineRow(f.typedId);
    expect(typed).toMatchObject({ product_id: body.product.id, item_status: "registered", typed_name: "Noran 20mg cap", name: "Noran 20mg cap", quantity: 3, unit: "strip", position: 1 });
    expect(typed.selling_price_snapshot).toBeNull();
    const other = await lineRow(f.otherId);
    expect(other).toMatchObject({ product_id: seedA.sellingOnlyId, quantity: 2, unit: "box", position: 2, typed_name: null });

    const after = await refetch(db, a.userId, f.id);
    expect(after.version).toBe(f.order.version + 1);
    expect(after.lines).toHaveLength(2);
    expect(after.lines[0]).toMatchObject({ product_id: body.product.id, item_status: "registered", typed_name: "Noran 20mg cap", quantity: 3, unit: "strip" });
    expect(res.order!.version).toBe(after.version);
  });

  it("keeps the exact typed text separately when the medicine's name is different", async () => {
    const f = await fixture(false, "  noran   20MG  cap ");
    const body = registerBody(f.order.version, { name: "Noran 20 mg Capsule" });
    const res = await dbRegister(db, a.userId, f.id, f.typedId, body);
    expect(res.done).toBe(true);
    const line = await lineRow(f.typedId);
    expect(line.name).toBe("Noran 20 mg Capsule");
    expect(line.typed_name).toBe("noran 20MG cap"); // spaces cleaned exactly as the order stores typed text
  });

  it("works on a draft and on a confirmed order; a confirmed line keeps its snapshot time and gets no price", async () => {
    const draft = await fixture(false);
    const confirmed = await fixture(true);
    const snapshotBefore = (await lineRow(confirmed.typedId)).snapshot_taken_at;
    expect(snapshotBefore).not.toBeNull();
    const r1 = await dbRegister(db, a.userId, draft.id, draft.typedId, registerBody(draft.order.version, { name: "Draft Medicine" }));
    const r2 = await dbRegister(db, a.userId, confirmed.id, confirmed.typedId, registerBody(confirmed.order.version, { name: "Confirmed Medicine" }));
    expect(r1.done).toBe(true);
    expect(r2.done).toBe(true);
    const line = await lineRow(confirmed.typedId);
    expect(line.snapshot_taken_at).toEqual(snapshotBefore);
    expect(line.selling_price_snapshot).toBeNull();
    expect(line).toMatchObject({ item_status: "registered", name: "Confirmed Medicine", typed_name: "Noran 20mg cap" });
    expect((await lineRow(draft.typedId)).snapshot_taken_at).toBeNull(); // a draft has no snapshot yet
  });

  it("records one linked event with how = registered and no purchase price or MRP", async () => {
    const f = await fixture(true);
    const body = registerBody(f.order.version, { name: "Event Medicine", purchase_price: "90.00", mrp: "130.00", selling_price: "125.50" });
    const res = await dbRegister(db, a.userId, f.id, f.typedId, body);
    expect(res.done).toBe(true);
    const events = await eventsOf(f.id, "linked");
    expect(events).toHaveLength(1);
    expect(events[0].order_version).toBe(f.order.version + 1);
    const entry = (events[0].detail.linked as Array<Record<string, unknown>>)[0];
    expect(entry).toMatchObject({ line_id: f.typedId, typed_name: "Noran 20mg cap", product_id: body.product.id, product_name: "Event Medicine", how: "registered", price_recorded: null });
    const text = JSON.stringify([events, res]);
    expect(text).not.toMatch(/purchase_price|"mrp"|90\.00|130\.00/);
    expect((await lineRow(f.typedId)).purchase_price_snapshot).toBeNull();
    expect((await lineRow(f.typedId)).mrp_snapshot).toBeNull();
  });
});

describe("duplicates and similar medicines", () => {
  it("blocks an exact duplicate (case and spacing ignored) and changes nothing", async () => {
    const f = await fixture(true);
    const before = await countProducts();
    const body = registerBody(f.order.version, { name: "  panadol   500MG ", strength: "500  mg", dosage_form: "TABLET", pack_size: "10", manufacturer: "gsk" });
    const res = await dbRegister(db, a.userId, f.id, f.typedId, body);
    expect(res.done).toBe(false);
    expect(res.reason).toBe("duplicate_product");
    expect(res.matches!.map((m) => m.id)).toEqual([seedA.pricedId]);
    expect(await countProducts()).toBe(before);
    expect((await lineRow(f.typedId)).product_id).toBeNull();
    expect((await refetch(db, a.userId, f.id)).version).toBe(f.order.version);
  });

  it("blocks a duplicate of an inactive medicine too", async () => {
    const inactive = await insertMedicine(db, a.businessId, { name: "Old Syrup", unit: "bottle", strength: "5 mg", is_active: false });
    const f = await fixture(false);
    const res = await dbRegister(db, a.userId, f.id, f.typedId, registerBody(f.order.version, { name: "Old Syrup", unit: "bottle", strength: "5 mg" }));
    expect(res.reason).toBe("duplicate_product");
    expect(res.matches![0]).toMatchObject({ id: inactive, is_active: false });
  });

  it("asks for confirmation when only the strength differs, never merges, then creates a separate medicine", async () => {
    const f = await fixture(false);
    const before = await countProducts();
    const first = await dbRegister(db, a.userId, f.id, f.typedId, registerBody(f.order.version, { name: "Panadol 500mg", strength: "250 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK" }));
    expect(first.reason).toBe("similar_products");
    expect(first.matches!.map((m) => m.id)).toContain(seedA.pricedId);
    expect(await countProducts()).toBe(before);
    expect((await lineRow(f.typedId)).product_id).toBeNull();

    const body = registerBody(f.order.version, { name: "Panadol 500mg", strength: "250 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK" }, { confirm_similar: true });
    const second = await dbRegister(db, a.userId, f.id, f.typedId, body);
    expect(second.done).toBe(true);
    expect(await countProducts()).toBe(before + 1);
    expect((await lineRow(f.typedId)).product_id).toBe(body.product.id);
    // the original medicine is untouched
    expect((await db.query<{ strength: string }>(`select strength from public.products where id = $1`, [seedA.pricedId])).rows[0].strength).toBe("500 mg");
  });

  it("refuses a code (SKU) that another medicine already uses, ignoring case", async () => {
    await insertMedicine(db, a.businessId, { name: "Coded Medicine", unit: "box", sku: "SKU-777" });
    const f = await fixture(false);
    const before = await countProducts();
    const res = await dbRegister(db, a.userId, f.id, f.typedId, registerBody(f.order.version, { name: "Another Name", sku: "sku-777" }));
    expect(res.reason).toBe("sku_conflict");
    expect(res.matches![0].name).toBe("Coded Medicine");
    expect(await countProducts()).toBe(before);
  });
});

describe("validation", () => {
  it("returns every field problem and creates nothing", async () => {
    const f = await fixture(false);
    const before = await countProducts();
    const res = await dbRegister(
      db, a.userId, f.id, f.typedId,
      registerBody(f.order.version, { name: "   ", unit: "", strength: "s".repeat(101), selling_price: "12.345", purchase_price: "-5", mrp: "abc", sku: "k".repeat(101) }),
    );
    expect(res.done).toBe(false);
    expect(res.reason).toBe("invalid_product");
    expect(Object.keys(res.fields!).sort()).toEqual(["mrp", "name", "purchase_price", "selling_price", "sku", "strength", "unit"]);
    expect(await countProducts()).toBe(before);
    expect((await lineRow(f.typedId)).product_id).toBeNull();
  });

  it("accepts the largest allowed price and refuses one digit more", async () => {
    const f = await fixture(false);
    const ok = await dbRegister(db, a.userId, f.id, f.typedId, registerBody(f.order.version, { name: "Big Price", selling_price: "9999999999.99" }));
    expect(ok.done).toBe(true);
    const g = await fixture(false);
    const bad = await dbRegister(db, a.userId, g.id, g.typedId, registerBody(g.order.version, { name: "Too Big", selling_price: "10000000000.00" }));
    expect(bad.fields).toHaveProperty("selling_price");
  });
});

describe("refusals about the order and the line", () => {
  it("refuses a stale version with the current order", async () => {
    const f = await fixture(false);
    const res = await dbRegister(db, a.userId, f.id, f.typedId, registerBody(f.order.version - 1 || 99));
    expect(res.reason).toBe("version_conflict");
    expect(res.current!.id).toBe(f.id);
    expect((await lineRow(f.typedId)).product_id).toBeNull();
  });

  it("refuses a cancelled order", async () => {
    const f = await fixture(true);
    const cancelled = await dbCancel(db, a.userId, f.id, f.order.version, "test");
    expect(cancelled.cancelled).toBe(true);
    const res = await dbRegister(db, a.userId, f.id, f.typedId, registerBody(cancelled.order!.version));
    expect(res.reason).toBe("order_not_editable");
    expect((await lineRow(f.typedId)).product_id).toBeNull();
  });

  it("refuses a line that is already linked (a second register with a new request)", async () => {
    const f = await fixture(false);
    const first = await dbRegister(db, a.userId, f.id, f.typedId, registerBody(f.order.version, { name: "First" }));
    expect(first.done).toBe(true);
    const second = await dbRegister(db, a.userId, f.id, f.typedId, registerBody(first.order!.version, { name: "Second" }));
    expect(second.reason).toBe("line_not_pending");
    expect(second.current!.lines[0].product_id).toBe(first.product!.id);
    // a catalog line cannot be registered either
    const third = await dbRegister(db, a.userId, f.id, f.otherId, registerBody(first.order!.version, { name: "Third" }));
    expect(third.reason).toBe("line_not_pending");
  });

  it("refuses a removed line and a line of another order", async () => {
    const f = await fixture(false);
    const g = await fixture(false);
    await db.query(`update public.order_lines set removed_at = now() where id = $1`, [g.typedId]);
    const removed = await dbRegister(db, a.userId, g.id, g.typedId, registerBody(g.order.version));
    expect(removed.reason).toBe("line_not_found");
    const wrongOrder = await dbRegister(db, a.userId, f.id, g.otherId, registerBody(f.order.version));
    expect(wrongOrder.reason).toBe("line_not_found");
  });

  it("refuses an order of another business and a medicine id used by another business, revealing nothing", async () => {
    const f = await fixture(false);
    const asB = await dbRegister(db, b.userId, f.id, f.typedId, registerBody(f.order.version));
    expect(asB.reason).toBe("not_found");
    expect((await lineRow(f.typedId)).product_id).toBeNull();

    const foreignId = await insertMedicine(db, b.businessId, { name: "B's medicine", unit: "box" });
    const res = await dbRegister(db, a.userId, f.id, f.typedId, registerBody(f.order.version, { id: foreignId, name: "Mine" }));
    expect(res.reason).toBe("unusable_id");
    expect((await lineRow(f.typedId)).product_id).toBeNull();
    expect(seedB.storeId).toBeTruthy();
  });
});

describe("repeating a request", () => {
  it("returns the stored result with replayed = true and changes nothing more", async () => {
    const f = await fixture(true);
    const before = await countProducts();
    const body = registerBody(f.order.version, { name: "Replay Medicine" });
    const first = await dbRegister(db, a.userId, f.id, f.typedId, body);
    expect(first.done).toBe(true);
    const versionAfter = (await refetch(db, a.userId, f.id)).version;
    const again = await dbRegister(db, a.userId, f.id, f.typedId, body);
    expect(again.done).toBe(true);
    expect(again.replayed).toBe(true);
    expect(again.product!.id).toBe(first.product!.id);
    expect(await countProducts()).toBe(before + 1);
    expect((await refetch(db, a.userId, f.id)).version).toBe(versionAfter);
    expect(await eventsOf(f.id, "linked")).toHaveLength(1);
  });

  it("returns every simultaneous identical request the same result", async () => {
    const f = await fixture(false);
    const before = await countProducts();
    const body = registerBody(f.order.version, { name: "Simultaneous Medicine" });
    const results = await Promise.all(Array.from({ length: 6 }, () => dbRegister(db, a.userId, f.id, f.typedId, body)));
    expect(results.every((r) => r.done === true)).toBe(true);
    expect(results.filter((r) => r.replayed === false)).toHaveLength(1);
    expect(new Set(results.map((r) => r.product!.id)).size).toBe(1);
    expect(await countProducts()).toBe(before + 1);
    expect(await eventsOf(f.id, "linked")).toHaveLength(1);
  });

  it("refuses a request id that was used for another kind of request", async () => {
    const f = await fixture(false);
    const g = await fixture(false);
    const body = registerBody(f.order.version, { name: "Kind Mix" });
    await db.query(`insert into public.pending_requests (business_id, request_id, kind, result) values ($1, $2, 'link', '{}'::jsonb)`, [a.businessId, body.request_id]);
    const res = await dbRegister(db, a.userId, g.id, g.typedId, body);
    expect(res.reason).toBe("invalid_request");
  });
});

describe("the selling price of the new medicine on a confirmed order", () => {
  it("is recorded on the line only when the supplier agreed, and the history says so", async () => {
    const f = await fixture(true);
    const body = registerBody(f.order.version, { name: "Priced Medicine", selling_price: "125.50" }, { apply_price: true });
    const res = await dbRegister(db, a.userId, f.id, f.typedId, body);
    expect(res.done).toBe(true);
    expect(res.price_applied).toBe(true);
    const line = await lineRow(f.typedId);
    expect(String(line.selling_price_snapshot)).toBe("125.50");
    expect(String(line.line_total)).toBe("376.50");
    const entry = ((await eventsOf(f.id, "linked"))[0].detail.linked as Array<Record<string, unknown>>)[0];
    expect(entry.price_recorded).toBe("125.50");
  });

  it("leaves the line unpriced when the supplier declined", async () => {
    const f = await fixture(true);
    const res = await dbRegister(db, a.userId, f.id, f.typedId, registerBody(f.order.version, { name: "Declined Price", selling_price: "125.50" }, { apply_price: false }));
    expect(res.done).toBe(true);
    expect(res.price_applied).toBe(false);
    expect((await lineRow(f.typedId)).selling_price_snapshot).toBeNull();
    const entry = ((await eventsOf(f.id, "linked"))[0].detail.linked as Array<Record<string, unknown>>)[0];
    expect(entry.price_recorded).toBeNull();
  });

  it("does nothing about a price on a draft (the draft follows the medicine's current price)", async () => {
    const f = await fixture(false);
    const res = await dbRegister(db, a.userId, f.id, f.typedId, registerBody(f.order.version, { name: "Draft Priced", selling_price: "125.50" }, { apply_price: true }));
    expect(res.done).toBe(true);
    expect(res.price_applied).toBe(false);
    const line = await lineRow(f.typedId);
    expect(line.snapshot_taken_at).toBeNull();
    expect(line.selling_price_snapshot).toBeNull();
    const order = await refetch(db, a.userId, f.id);
    expect(order.lines[0]).toMatchObject({ price_basis: "current", selling_price: "125.50" });
  });

  it("does not apply a price when the new medicine has none", async () => {
    const f = await fixture(true);
    const res = await dbRegister(db, a.userId, f.id, f.typedId, registerBody(f.order.version, { name: "No Price" }, { apply_price: true }));
    expect(res.done).toBe(true);
    expect(res.price_applied).toBe(false);
    expect((await lineRow(f.typedId)).selling_price_snapshot).toBeNull();
  });
});

describe("all or nothing", () => {
  it("rolls everything back when a step after the insert fails", async () => {
    const f = await fixture(false);
    const before = await countProducts();
    const failing = registerBody(f.order.version, { name: "Never Created" });
    await db.exec(`
      create function public.tmp_fail_linked() returns trigger language plpgsql as $$
      begin raise exception 'injected failure'; end; $$;
      create trigger tmp_fail_linked before insert on public.order_events
        for each row when (new.event_type = 'linked') execute function public.tmp_fail_linked();
    `);
    try {
      await expect(dbRegister(db, a.userId, f.id, f.typedId, failing)).rejects.toThrow(/injected failure/);
    } finally {
      await db.exec(`drop trigger tmp_fail_linked on public.order_events; drop function public.tmp_fail_linked();`);
    }
    expect(await countProducts()).toBe(before);
    expect((await db.query(`select 1 from public.products where name = 'Never Created'`)).rows).toHaveLength(0);
    expect((await lineRow(f.typedId)).product_id).toBeNull();
    expect((await refetch(db, a.userId, f.id)).version).toBe(f.order.version);
    // nothing was recorded for the failed request, so a retry after the failure is not mistaken for a replay
    expect((await db.query(`select 1 from public.pending_requests where request_id = $1`, [failing.request_id])).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.order_events where order_id = $1 and event_type = 'linked'`, [f.id])).rows).toHaveLength(0);
  });

  it("leaves the snapshot-edit flag off after a success and after a refusal", async () => {
    const f = await fixture(true);
    const g = await fixture(true);
    await db.exec(`begin`);
    try {
      const ok = await dbRegister(db, a.userId, f.id, f.typedId, registerBody(f.order.version, { name: "Flag Success" }));
      expect(ok.done).toBe(true);
      const flag1 = (await db.query<{ v: string | null }>(`select current_setting('app.line_snapshot_edit', true) as v`)).rows[0].v;
      expect(flag1 === null || flag1 === "" || flag1 === "off").toBe(true);
      const refused = await dbRegister(db, a.userId, g.id, g.typedId, registerBody(g.order.version - 1 || 99, { name: "Flag Refusal" }));
      expect(refused.done).toBe(false);
      const flag2 = (await db.query<{ v: string | null }>(`select current_setting('app.line_snapshot_edit', true) as v`)).rows[0].v;
      expect(flag2 === null || flag2 === "" || flag2 === "off").toBe(true);
    } finally {
      await db.exec(`rollback`);
    }
  });

  it("does not let a signed-in user call the internal link helper or write the order tables", async () => {
    const f = await fixture(false);
    await expect(
      withRole(db, "authenticated", a.userId, () =>
        db.query(`select public.pending_link_line($1, $2, $3, null::public.products, 'existing', false)`, [a.businessId, f.id, f.typedId]),
      ),
    ).rejects.toThrow();
    await expect(
      withRole(db, "authenticated", a.userId, () => db.query(`update public.order_lines set product_id = $2, item_status = 'registered' where id = $1`, [f.typedId, seedA.pricedId])),
    ).rejects.toThrow();
    expect(randomUUID()).toBeTruthy();
  });
});
