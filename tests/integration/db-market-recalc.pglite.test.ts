import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import { catalogLine, savePayload, typedLine } from "../helpers/orders";
import { dbCancel, dbConfirm, dbSave } from "../helpers/orders-db";
import { dbLink, dbRegister, insertMedicine, insertStore, refetch } from "../helpers/pending-db";
import { linkBody, registerBody } from "../helpers/pending";
import { dbMarketList, dbRecord, pkt, seedConfirmedOrder, seedDraftOrder, setConfirmedAt } from "../helpers/market-db";

// The list follows the orders (spec FR-005): it is computed on every read, so every change to an order shows
// at once, and purchases already recorded are never lost by it.

const DAY = "2026-11-12";
const at = (time = "10:00") => pkt(DAY, time);

let db: PGlite;
let counter = 0;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  await db.close();
});

async function fresh(storeNames: string[] = ["Al Madina"]) {
  counter += 1;
  const t: Tenant = await createTenant(db, `recalc${counter}`);
  const stores: Record<string, string> = {};
  for (const name of storeNames) stores[name] = await insertStore(db, t.businessId, name);
  const panadol = await insertMedicine(db, t.businessId, { name: "Panadol", unit: "strip" });
  return { t, stores, panadol };
}

const total = async (t: Tenant, name = "Panadol") => {
  const list = await dbMarketList(db, t.userId, { date: DAY });
  return list.rows.find((r) => r.name === name)?.total_requested ?? 0;
};

describe("the list follows the orders", () => {
  it("shows a changed quantity of a confirmed order", async () => {
    const { t, stores, panadol } = await fresh();
    const order = await seedConfirmedOrder(db, t.userId, stores["Al Madina"], [catalogLine(panadol, 20)], at());
    expect(await total(t)).toBe(20);

    const line = order.order.lines[0];
    const saved = await dbSave(db, t.userId, order.id, savePayload(stores["Al Madina"], [{ id: line.id, product_id: panadol, name: null, quantity: 25, unit: "strip" }], { expected_version: order.order.version }));
    expect(saved.saved).toBe(true);
    expect(await total(t)).toBe(25);
  });

  it("drops a line that was removed from a confirmed order", async () => {
    const { t, stores, panadol } = await fresh();
    const brufen = await insertMedicine(db, t.businessId, { name: "Brufen", unit: "strip" });
    const order = await seedConfirmedOrder(db, t.userId, stores["Al Madina"], [catalogLine(panadol, 20), catalogLine(brufen, 5)], at());
    const keep = order.order.lines.find((l) => l.product_id === panadol)!;
    const saved = await dbSave(db, t.userId, order.id, savePayload(stores["Al Madina"], [{ id: keep.id, product_id: panadol, name: null, quantity: 20, unit: "strip" }], { expected_version: order.order.version }));
    expect(saved.saved).toBe(true);
    expect(await total(t, "Brufen")).toBe(0);
    expect(await total(t)).toBe(20);
  });

  it("drops a cancelled order and picks up a draft only once it is confirmed", async () => {
    const { t, stores, panadol } = await fresh(["Al Madina", "Shah Medical"]);
    const first = await seedConfirmedOrder(db, t.userId, stores["Al Madina"], [catalogLine(panadol, 20)], at());
    const draft = await seedDraftOrder(db, t.userId, stores["Shah Medical"], [catalogLine(panadol, 10)]);
    expect(await total(t)).toBe(20);

    const confirmed = await dbConfirm(db, t.userId, draft.id, draft.order.version);
    expect(confirmed.confirmed).toBe(true);
    await setConfirmedAt(db, draft.id, at("11:00"));
    expect(await total(t)).toBe(30);

    const current = await refetch(db, t.userId, first.id);
    const cancelled = await dbCancel(db, t.userId, first.id, current.version, "Store cancelled");
    expect(cancelled.cancelled).toBe(true);
    expect(await total(t)).toBe(10);
  });
});

describe("typed lines move into the normal rows when they are registered or linked (Module 004)", () => {
  it("moves a registered typed line into its new medicine's row", async () => {
    const { t, stores } = await fresh(["Al Madina", "Shah Medical"]);
    const a = await seedConfirmedOrder(db, t.userId, stores["Al Madina"], [typedLine("Noran 20mg cap", 4)], at());
    await seedConfirmedOrder(db, t.userId, stores["Shah Medical"], [typedLine("noran 20mg cap", 6)], at("11:00"));
    let list = await dbMarketList(db, t.userId, { date: DAY });
    expect(list.typed_rows).toHaveLength(1);
    expect(list.typed_rows[0].total_requested).toBe(10);

    const lineId = a.order.lines[0].id;
    const order = await refetch(db, t.userId, a.id);
    const result = await dbRegister(db, t.userId, a.id, lineId, registerBody(order.version, { name: "Noran 20mg cap", unit: "strip" }));
    expect(result.done).toBe(true);

    list = await dbMarketList(db, t.userId, { date: DAY });
    // Only the registered line moved; the other store's typed line still waits (nothing is linked automatically).
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({ name: "Noran 20mg cap", total_requested: 4, can_record: true });
    expect(list.typed_rows).toHaveLength(1);
    expect(list.typed_rows[0].total_requested).toBe(6);
    expect(list.totals.requested).toBe(10); // nothing was lost on the way
  });

  it("moves a linked typed line into the existing medicine's row and adds it to that row's total", async () => {
    const { t, stores, panadol } = await fresh(["Al Madina", "Shah Medical"]);
    await seedConfirmedOrder(db, t.userId, stores["Al Madina"], [catalogLine(panadol, 20)], at());
    const typed = await seedConfirmedOrder(db, t.userId, stores["Shah Medical"], [typedLine("panadol", 5)], at("11:00"));
    expect((await dbMarketList(db, t.userId, { date: DAY })).typed_rows).toHaveLength(1);

    const order = await refetch(db, t.userId, typed.id);
    const linked = await dbLink(db, t.userId, typed.id, order.lines[0].id, linkBody(order.version, panadol));
    expect(linked.done).toBe(true);

    const list = await dbMarketList(db, t.userId, { date: DAY });
    expect(list.typed_rows).toEqual([]);
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0].total_requested).toBe(25);
    expect(list.rows[0].stores.map((s) => s.store_name)).toEqual(["Al Madina", "Shah Medical"]);
  });
});

describe("recorded purchases are never lost by a change of the orders", () => {
  it("keeps the purchased quantity when an order is cancelled, and shows Bought extra when more was bought than is now needed", async () => {
    const { t, stores, panadol } = await fresh(["Al Madina", "Shah Medical"]);
    await seedConfirmedOrder(db, t.userId, stores["Al Madina"], [catalogLine(panadol, 20)], at());
    const second = await seedConfirmedOrder(db, t.userId, stores["Shah Medical"], [catalogLine(panadol, 25)], at("11:00"));
    const bought = await dbRecord(db, t.userId, { product: panadol, unit: "strip", date: DAY, quantity: 40 });
    expect(bought.done).toBe(true);
    expect(await dbMarketList(db, t.userId, { date: DAY }).then((l) => l.rows[0])).toMatchObject({ total_requested: 45, purchased: 40, remaining: 5, status: "partly_bought" });

    const current = await refetch(db, t.userId, second.id);
    await dbCancel(db, t.userId, second.id, current.version, "Store cancelled");
    const row = (await dbMarketList(db, t.userId, { date: DAY })).rows[0];
    expect(row).toMatchObject({ total_requested: 20, purchased: 40, remaining: 0, extra: 20, status: "bought_extra" });
  });

  it("does not count a purchase recorded for another day", async () => {
    const { t, stores, panadol } = await fresh();
    await seedConfirmedOrder(db, t.userId, stores["Al Madina"], [catalogLine(panadol, 20)], at());
    // The purchase date can be any earlier day; this one counts for 2026-11-10, not for DAY.
    await dbRecord(db, t.userId, { product: panadol, unit: "strip", date: "2026-11-10", quantity: 7, id: randomUUID() });
    const row = (await dbMarketList(db, t.userId, { date: DAY })).rows[0];
    expect(row).toMatchObject({ purchased: 0, remaining: 20, status: "not_bought" });
  });
});
