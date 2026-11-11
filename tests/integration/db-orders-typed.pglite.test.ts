import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogLine, savePayload, seedWithDb, typedLine, type Seeded } from "../helpers/orders";
import { createDraft, dbConfirm, dbSave } from "../helpers/orders-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// Typed (not registered) lines: an unknown medicine never blocks saving or confirming, keeps its exact
// text, and carries no invented value.

let db: PGlite;
let a: Tenant;
let seedA: Seeded;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
  seedA = await seedWithDb(db, a.businessId);
});
afterAll(async () => {
  await db.close();
});

describe("typed lines", () => {
  it("stores the exact typed name (only spaces cleaned) with no medicine, no description and a pending-registration status", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [typedLine("  Noran   20MG   Cap ", 3, "strip")]);
    expect(order.lines[0]).toMatchObject({ product_id: null, item_status: "pending_registration", name: "Noran 20MG Cap", strength: null, dosage_form: null, pack_size: null, manufacturer: null, quantity: 3, unit: "strip" });
    const row = await db.query<{ product_id: string | null; item_status: string }>(`select product_id, item_status from public.order_lines where order_id = $1`, [id]);
    expect(row.rows[0]).toEqual({ product_id: null, item_status: "pending_registration" });
  });

  it("keeps Urdu and mixed-script text exactly", async () => {
    const { order } = await createDraft(db, a.userId, seedA.storeId, [typedLine("پینا ڈول 500mg")]);
    expect(order.lines[0].name).toBe("پینا ڈول 500mg");
  });

  it("saves and confirms an order that has only typed lines; nothing is invented", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [typedLine("Unknown Syrup", 2, "bottle"), typedLine("Another Unknown", 5, "box")]);
    const confirmed = await dbConfirm(db, a.userId, id, order.version);
    expect(confirmed).toMatchObject({ confirmed: true });
    for (const line of confirmed.order!.lines) {
      expect(line).toMatchObject({ item_status: "pending_registration", price_basis: "none", selling_price: null, line_total: null });
    }
    expect(confirmed.order!.totals).toEqual({ priced_total: "0.00", priced_lines: 0, unpriced_lines: 2, line_count: 2 });
    const rows = await db.query<{ snapshot_taken_at: string | null; purchase_price_snapshot: string | null; selling_price_snapshot: string | null; mrp_snapshot: string | null; delivered_quantity: number; line_total: string | null }>(
      `select snapshot_taken_at, purchase_price_snapshot, selling_price_snapshot, mrp_snapshot, delivered_quantity, line_total from public.order_lines where order_id = $1 order by position`,
      [id],
    );
    for (const row of rows.rows) {
      expect(row.snapshot_taken_at).not.toBeNull(); // recorded as part of the confirmed order
      expect([row.purchase_price_snapshot, row.selling_price_snapshot, row.mrp_snapshot, row.line_total]).toEqual([null, null, null, null]);
    }
    expect(rows.rows.map((r) => r.delivered_quantity)).toEqual([2, 5]);
  });

  it("mixes typed and catalog lines: the catalog line is priced, the typed one is not", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 2), typedLine("Not In Catalog", 1, "box")]);
    const confirmed = await dbConfirm(db, a.userId, id, order.version);
    expect(confirmed.order!.lines.map((l) => [l.name, l.price_basis, l.line_total])).toEqual([
      ["Panadol 500mg", "snapshot", "251.00"],
      ["Not In Catalog", "none", null],
    ]);
    expect(confirmed.order!.totals).toMatchObject({ priced_total: "251.00", priced_lines: 1, unpriced_lines: 1 });
  });

  it("accepts the same typed text twice in one order (the warning is a screen rule, not a database rule)", async () => {
    const { order } = await createDraft(db, a.userId, seedA.storeId, [typedLine("Twice"), typedLine("Twice")]);
    expect(order.lines).toHaveLength(2);
  });

  it("lets a typed line's name be edited while the order is a draft, but not after confirmation", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [typedLine("Wrong Name", 1)]);
    const lineId = order.lines[0].id;
    const renamed = await dbSave(db, a.userId, id, savePayload(seedA.storeId, [typedLine("Right Name", 4, "box", { id: lineId })], { expected_version: order.version }));
    expect(renamed.order!.lines[0]).toMatchObject({ name: "Right Name", quantity: 4, unit: "box" });
    const confirmed = await dbConfirm(db, a.userId, id, renamed.order!.version);
    const afterConfirm = await dbSave(db, a.userId, id, savePayload(seedA.storeId, [typedLine("Changed Again", 4, "box", { id: lineId })], { expected_version: confirmed.order!.version }));
    expect(afterConfirm).toMatchObject({ saved: false, reason: "invalid_lines" });
  });

  it("cannot be linked through any order function, but the table can later be linked without losing the typed name", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [typedLine("Panadol", 2, "strip")]);
    const confirmed = await dbConfirm(db, a.userId, id, order.version);
    // order_save refuses a medicine change on an existing line
    const viaSave = await dbSave(db, a.userId, id, savePayload(seedA.storeId, [catalogLine(seedA.pricedId, 2, "strip", { id: order.lines[0].id })], { expected_version: confirmed.order!.version }));
    expect(viaSave).toMatchObject({ saved: false, reason: "invalid_lines" });
    // The path a later module will use: set product_id and item_status together; the typed name stays.
    await db.query(`update public.order_lines set product_id = $1, item_status = 'registered' where id = $2`, [seedA.pricedId, order.lines[0].id]);
    const row = await db.query<{ name: string; product_id: string; item_status: string }>(`select name, product_id, item_status from public.order_lines where id = $1`, [order.lines[0].id]);
    expect(row.rows[0]).toEqual({ name: "Panadol", product_id: seedA.pricedId, item_status: "registered" });
  });

  it("needs a name for a typed line", async () => {
    expect(await dbSave(db, a.userId, randomUUID(), savePayload(seedA.storeId, [typedLine("  ")]))).toMatchObject({ saved: false, reason: "invalid_lines" });
  });
});
