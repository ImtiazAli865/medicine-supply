import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbCancel, dbConfirm } from "../helpers/orders-db";
import { catalogLine, seedWithDb, typedLine, type Seeded } from "../helpers/orders";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import { linkBody } from "../helpers/pending";
import { createPendingOrder, dbLink, insertMedicine, refetch, type PendingOrder } from "../helpers/pending-db";

// Linking a typed line to an existing medicine (pending_line_link) on a real PostgreSQL engine (PGlite): only the
// chosen line changes, quantities and units stay, and every refusal changes nothing.

let db: PGlite;
let a: Tenant;
let b: Tenant;
let seedA: Seeded;
let seedB: Seeded;

interface Fixture extends PendingOrder {
  typedId: string;
  otherId: string;
}

async function fixture(confirm: boolean, typedName = "panadol 500"): Promise<Fixture> {
  const o = await createPendingOrder(db, a.userId, seedA.storeId, [typedLine(typedName, 3, "strip"), catalogLine(seedA.sellingOnlyId, 2, "box")], { confirm });
  return { ...o, typedId: o.order.lines[0].id, otherId: o.order.lines[1].id };
}

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

describe("linking one line", () => {
  it("links the line to the chosen medicine, keeps the typed text, quantity, unit and position, and bumps the version once", async () => {
    const f = await fixture(true);
    const res = await dbLink(db, a.userId, f.id, f.typedId, linkBody(f.order.version, seedA.pricedId));
    expect(res.done).toBe(true);
    expect(res.replayed).toBe(false);
    expect(res.product).toMatchObject({ id: seedA.pricedId, name: "Panadol 500mg" });
    const line = await lineRow(f.typedId);
    expect(line).toMatchObject({
      product_id: seedA.pricedId, item_status: "registered", typed_name: "panadol 500", name: "Panadol 500mg",
      strength: "500 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK", quantity: 3, unit: "strip", position: 1,
    });
    expect(line.selling_price_snapshot).toBeNull(); // no price unless the supplier agreed
    expect(line.purchase_price_snapshot).toBeNull();
    expect(line.mrp_snapshot).toBeNull();
    const after = await refetch(db, a.userId, f.id);
    expect(after.version).toBe(f.order.version + 1);
    expect(after.lines.map((l) => l.id)).toEqual(f.lineIds);
  });

  it("records one linked event with how = existing, or proposal when the link came from a proposal", async () => {
    const f = await fixture(false);
    const g = await fixture(false);
    await dbLink(db, a.userId, f.id, f.typedId, linkBody(f.order.version, seedA.pricedId));
    await dbLink(db, a.userId, g.id, g.typedId, linkBody(g.order.version, seedA.pricedId, { how: "proposal" }));
    const e1 = (await eventsOf(f.id, "linked"))[0];
    const e2 = (await eventsOf(g.id, "linked"))[0];
    expect((e1.detail.linked as Array<Record<string, unknown>>)[0]).toMatchObject({ line_id: f.typedId, typed_name: "panadol 500", product_id: seedA.pricedId, how: "existing", price_recorded: null });
    expect((e2.detail.linked as Array<Record<string, unknown>>)[0]).toMatchObject({ how: "proposal" });
    expect(e1.order_version).toBe(f.order.version + 1);
    expect(JSON.stringify([e1, e2])).not.toMatch(/purchase_price|"mrp"|"90\.00"|"130\.00"/);
  });

  it("allows a medicine with a different strength only because the supplier picked it, and links just that line", async () => {
    const f = await fixture(false, "panadol 250");
    const other = await insertMedicine(db, a.businessId, { name: "Panadol 250mg", unit: "strip", strength: "250 mg" });
    const res = await dbLink(db, a.userId, f.id, f.typedId, linkBody(f.order.version, other));
    expect(res.done).toBe(true);
    expect(await lineRow(f.typedId)).toMatchObject({ product_id: other, typed_name: "panadol 250", strength: "250 mg" });
    expect((await lineRow(f.otherId)).typed_name).toBeNull();
  });

  it("never touches another line, another order, or another business", async () => {
    const f = await fixture(true, "same text");
    const twin = await fixture(true, "same text"); // the same typed text in another order
    const foreign = await createPendingOrder(db, b.userId, seedB.storeId, [typedLine("same text", 1, "strip")], { confirm: true });
    const twinVersion = (await refetch(db, a.userId, twin.id)).version;
    await dbLink(db, a.userId, f.id, f.typedId, linkBody(f.order.version, seedA.pricedId));
    expect((await lineRow(twin.typedId)).product_id).toBeNull();
    expect((await refetch(db, a.userId, twin.id)).version).toBe(twinVersion);
    expect((await lineRow(foreign.lineIds[0])).product_id).toBeNull();
    expect((await lineRow(f.otherId)).product_id).toBe(seedA.sellingOnlyId);
  });
});

describe("refusals", () => {
  it("refuses an inactive medicine and one that does not exist", async () => {
    const inactive = await insertMedicine(db, a.businessId, { name: "Retired", unit: "box", is_active: false });
    const f = await fixture(false);
    expect((await dbLink(db, a.userId, f.id, f.typedId, linkBody(f.order.version, inactive))).reason).toBe("product_inactive");
    expect((await dbLink(db, a.userId, f.id, f.typedId, linkBody(f.order.version, "00000000-0000-4000-8000-000000000001"))).reason).toBe("product_not_found");
    expect((await lineRow(f.typedId)).product_id).toBeNull();
    expect((await refetch(db, a.userId, f.id)).version).toBe(f.order.version);
  });

  it("refuses another business's medicine and another business's order, revealing nothing", async () => {
    const f = await fixture(false);
    expect((await dbLink(db, a.userId, f.id, f.typedId, linkBody(f.order.version, seedB.pricedId))).reason).toBe("product_not_found");
    expect((await dbLink(db, b.userId, f.id, f.typedId, linkBody(f.order.version, seedB.pricedId))).reason).toBe("not_found");
    expect((await lineRow(f.typedId)).product_id).toBeNull();
  });

  it("refuses an already linked line, a stale version and a cancelled order", async () => {
    const f = await fixture(true);
    const first = await dbLink(db, a.userId, f.id, f.typedId, linkBody(f.order.version, seedA.pricedId));
    expect(first.done).toBe(true);
    const again = await dbLink(db, a.userId, f.id, f.typedId, linkBody(first.order!.version, seedA.pricedId));
    expect(again.reason).toBe("line_not_pending");
    const stale = await dbLink(db, a.userId, f.id, f.otherId, linkBody(f.order.version, seedA.pricedId));
    expect(stale.reason).toBe("version_conflict");
    expect(stale.current!.version).toBe(first.order!.version);

    const g = await fixture(true);
    const cancelled = await dbCancel(db, a.userId, g.id, g.order.version, "test");
    const res = await dbLink(db, a.userId, g.id, g.typedId, linkBody(cancelled.order!.version, seedA.pricedId));
    expect(res.reason).toBe("order_not_editable");
    expect((await lineRow(g.typedId)).product_id).toBeNull();
  });
});

describe("repeating a request", () => {
  it("returns the stored result with replayed = true and writes nothing more", async () => {
    const f = await fixture(true);
    const body = linkBody(f.order.version, seedA.pricedId);
    const first = await dbLink(db, a.userId, f.id, f.typedId, body);
    const versionAfter = (await refetch(db, a.userId, f.id)).version;
    const again = await dbLink(db, a.userId, f.id, f.typedId, body);
    expect(again.replayed).toBe(true);
    expect(again.product!.id).toBe(first.product!.id);
    expect((await refetch(db, a.userId, f.id)).version).toBe(versionAfter);
    expect(await eventsOf(f.id, "linked")).toHaveLength(1);
  });

  it("returns every simultaneous identical request the same result", async () => {
    const f = await fixture(false);
    const body = linkBody(f.order.version, seedA.pricedId);
    const results = await Promise.all(Array.from({ length: 6 }, () => dbLink(db, a.userId, f.id, f.typedId, body)));
    expect(results.every((r) => r.done === true)).toBe(true);
    expect(results.filter((r) => r.replayed === false)).toHaveLength(1);
    expect(await eventsOf(f.id, "linked")).toHaveLength(1);
  });
});

describe("the selling price on a confirmed order", () => {
  it("is recorded on the line only when the supplier agreed and the line had no price", async () => {
    const yes = await fixture(true);
    const res = await dbLink(db, a.userId, yes.id, yes.typedId, linkBody(yes.order.version, seedA.pricedId, { apply_price: true }));
    expect(res.price_applied).toBe(true);
    expect(String((await lineRow(yes.typedId)).selling_price_snapshot)).toBe("125.50");
    expect(String((await lineRow(yes.typedId)).line_total)).toBe("376.50");
    expect(((await eventsOf(yes.id, "linked"))[0].detail.linked as Array<Record<string, unknown>>)[0].price_recorded).toBe("125.50");

    const no = await fixture(true);
    const declined = await dbLink(db, a.userId, no.id, no.typedId, linkBody(no.order.version, seedA.pricedId, { apply_price: false }));
    expect(declined.price_applied).toBe(false);
    expect((await lineRow(no.typedId)).selling_price_snapshot).toBeNull();
  });

  it("never replaces a price the line already has", async () => {
    const f = await fixture(true);
    // a price that is already on the line (set the way only a controlled function may)
    await db.exec(`begin; select set_config('app.line_snapshot_edit', 'on', true);
      update public.order_lines set selling_price_snapshot = 50.00 where id = '${f.typedId}'; commit;`);
    const res = await dbLink(db, a.userId, f.id, f.typedId, linkBody(f.order.version, seedA.pricedId, { apply_price: true }));
    expect(res.done).toBe(true);
    expect(res.price_applied).toBe(false);
    expect(String((await lineRow(f.typedId)).selling_price_snapshot)).toBe("50.00");
  });

  it("does nothing when the medicine has no price", async () => {
    const f = await fixture(true);
    const res = await dbLink(db, a.userId, f.id, f.typedId, linkBody(f.order.version, seedA.noPriceId, { apply_price: true }));
    expect(res.price_applied).toBe(false);
    expect((await lineRow(f.typedId)).selling_price_snapshot).toBeNull();
  });

  it("does nothing on a draft: the draft follows the live price and takes its snapshot when confirmed", async () => {
    const f = await fixture(false);
    const res = await dbLink(db, a.userId, f.id, f.typedId, linkBody(f.order.version, seedA.pricedId, { apply_price: true }));
    expect(res.price_applied).toBe(false);
    expect((await lineRow(f.typedId)).snapshot_taken_at).toBeNull();
    const draft = await refetch(db, a.userId, f.id);
    expect(draft.lines[0]).toMatchObject({ price_basis: "current", selling_price: "125.50", typed_name: "panadol 500" });
    const confirmed = await dbConfirm(db, a.userId, f.id, draft.version);
    expect(confirmed.confirmed).toBe(true);
    const line = await lineRow(f.typedId);
    expect(String(line.selling_price_snapshot)).toBe("125.50");
    expect(line).toMatchObject({ typed_name: "panadol 500", name: "Panadol 500mg" });
  });
});
