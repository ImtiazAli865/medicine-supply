import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogLine, seedWithDb, typedLine, type Seeded } from "../helpers/orders";
import { createDraft, dbConfirm, dbGet } from "../helpers/orders-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// Price snapshots: recorded at confirm, never changed afterwards, and a draft shows the live price.

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

describe("a draft", () => {
  it("shows the medicine's current selling price, follows the catalog, and labels it as current", async () => {
    const { id } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 3)]);
    expect((await dbGet(db, a.userId, id))!.lines[0]).toMatchObject({ price_basis: "current", selling_price: "125.50", line_total: "376.50" });
    await db.query(`update public.products set selling_price = '130.00' where id = $1`, [seedA.pricedId]);
    try {
      expect((await dbGet(db, a.userId, id))!.lines[0]).toMatchObject({ price_basis: "current", selling_price: "130.00", line_total: "390.00" });
    } finally {
      await db.query(`update public.products set selling_price = '125.50' where id = $1`, [seedA.pricedId]);
    }
  });

  it("shows no price and no total for a medicine without a selling price, and counts it as unpriced", async () => {
    const { id } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.noPriceId, 4, "bottle"), catalogLine(seedA.pricedId, 2), catalogLine(seedA.sellingOnlyId, 1, "box")]);
    const order = (await dbGet(db, a.userId, id))!;
    expect(order.lines.map((l) => [l.name, l.price_basis, l.selling_price, l.line_total])).toEqual([
      ["Calpol Syrup", "none", null, null],
      ["Panadol 500mg", "current", "125.50", "251.00"],
      ["Brufen 400mg", "current", "310.00", "310.00"],
    ]);
    expect(order.totals).toEqual({ priced_total: "561.00", priced_lines: 2, unpriced_lines: 1, line_count: 3 });
  });
});

describe("confirming", () => {
  it("copies purchase price, selling price and MRP exactly (empty stays empty) and the description, with the time", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 3), catalogLine(seedA.sellingOnlyId, 1, "box"), catalogLine(seedA.noPriceId, 2, "bottle")]);
    await dbConfirm(db, a.userId, id, order.version);
    const rows = await db.query<{ name: string; purchase_price_snapshot: string | null; selling_price_snapshot: string | null; mrp_snapshot: string | null; snapshot_taken_at: string | null; line_total: string | null; strength: string | null; manufacturer: string | null }>(
      `select name, purchase_price_snapshot::text, selling_price_snapshot::text, mrp_snapshot::text, snapshot_taken_at, line_total::text, strength, manufacturer from public.order_lines where order_id = $1 order by position`,
      [id],
    );
    const [priced, sellingOnly, noPrice] = rows.rows;
    expect(priced).toMatchObject({ name: "Panadol 500mg", purchase_price_snapshot: "90.00", selling_price_snapshot: "125.50", mrp_snapshot: "130.00", line_total: "376.50", strength: "500 mg", manufacturer: "GSK" });
    expect(sellingOnly).toMatchObject({ purchase_price_snapshot: null, selling_price_snapshot: "310.00", mrp_snapshot: null, line_total: "310.00" });
    expect(noPrice).toMatchObject({ purchase_price_snapshot: null, selling_price_snapshot: null, mrp_snapshot: null, line_total: null });
    for (const row of rows.rows) expect(row.snapshot_taken_at).not.toBeNull();
  });

  it("keeps prices, totals and the medicine's description unchanged when the catalog changes afterwards", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 3), catalogLine(seedA.noPriceId, 1, "bottle")]);
    const confirmed = (await dbConfirm(db, a.userId, id, order.version)).order!;
    await db.query(`update public.products set selling_price = '999.00', purchase_price = '1.00', mrp = '5.00', name = 'Renamed Medicine', strength = '1000 mg' where id = $1`, [seedA.pricedId]);
    await db.query(`update public.products set selling_price = '77.00' where id = $1`, [seedA.noPriceId]); // a price added later must not appear on the old order
    try {
      const after = (await dbGet(db, a.userId, id))!;
      expect(after.lines).toEqual(confirmed.lines);
      expect(after.lines[0]).toMatchObject({ name: "Panadol 500mg", strength: "500 mg", price_basis: "snapshot", selling_price: "125.50", line_total: "376.50" });
      expect(after.lines[1]).toMatchObject({ price_basis: "none", selling_price: null, line_total: null });
      expect(after.totals).toEqual(confirmed.totals);
    } finally {
      await db.query(`update public.products set selling_price = '125.50', purchase_price = '90.00', mrp = '130.00', name = 'Panadol 500mg', strength = '500 mg' where id = $1`, [seedA.pricedId]);
      await db.query(`update public.products set selling_price = null where id = $1`, [seedA.noPriceId]);
    }
  });

  it("makes the snapshot immutable: a direct change of a recorded price is refused even for the table owner", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 1)]);
    await dbConfirm(db, a.userId, id, order.version);
    await expect(db.query(`update public.order_lines set selling_price_snapshot = '1.00' where order_id = $1`, [id])).rejects.toThrow(/snapshot_immutable/);
    await expect(db.query(`update public.order_lines set name = 'x' where order_id = $1`, [id])).rejects.toThrow(/snapshot_immutable/);
  });

  it("never returns purchase price or MRP: not on the order, not in the totals, not in the history", async () => {
    const { id, order } = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 1), typedLine("Typed")]);
    const confirmed = (await dbConfirm(db, a.userId, id, order.version)).order!;
    const text = JSON.stringify(await dbGet(db, a.userId, id)) + JSON.stringify(confirmed);
    expect(text).not.toMatch(/purchase|mrp|90\.00|130\.00/i);
  });
});
