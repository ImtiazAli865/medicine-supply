import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { getMarketList, listPurchases, recordPurchase, voidPurchase } from "@/lib/market/repository";
import { ListQuerySchema, RecordPurchaseBodySchema, VoidPurchaseBodySchema } from "@/lib/validation/market";
import { addDays, moneyKeys, pkt, recordBody, seedConfirmedWithClient, todayPkt } from "../helpers/market";
import { getOrderWithClient, seedMedicineWithClient, seedStoreWithClient } from "../helpers/pending";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// The purchase repository (the code behind POST /api/purchases, GET /api/purchases and the void route) against a
// real Supabase test project. Skipped without credentials.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const DAY = addDays(todayPkt(), -1);
const errorOf = async (promise: Promise<unknown>) => (await promise.then(() => null, (e) => e)) as ApiError | null;
const parse = (body: ReturnType<typeof recordBody>) => RecordPurchaseBodySchema().parse(body);

suite("purchase recording against Supabase", () => {
  let a: TestTenant;
  let b: TestTenant;
  let panadol: string;
  let orderId: string;
  const row = async (client = a.client) => (await getMarketList(client, ListQuerySchema().parse({ date: DAY }))).rows.find((r) => r.product_id === panadol);

  beforeAll(async () => {
    a = await createTenant("purchase-a");
    b = await createTenant("purchase-b");
    const s1 = await seedStoreWithClient(a.client, "Al Madina");
    const s2 = await seedStoreWithClient(a.client, "Shah Medical");
    panadol = await seedMedicineWithClient(a.client, { name: "Panadol", unit: "strip", purchase_price: "90.00", selling_price: "125.50", mrp: "130.00" });
    const first = await seedConfirmedWithClient(a.client, s1, [{ product_id: panadol, quantity: 20 }], pkt(DAY, "10:00"));
    await seedConfirmedWithClient(a.client, s2, [{ product_id: panadol, quantity: 25 }], pkt(DAY, "11:00"));
    orderId = first.orderId;
    await seedStoreWithClient(b.client, "B Pharmacy");
  }, 120_000);

  afterAll(async () => {
    await deleteTenant(a);
    await deleteTenant(b);
  });

  it("records 20 then 10 of 45: purchased 30, remaining 15, partly bought", async () => {
    const first = await recordPurchase(a.client, parse(recordBody(panadol, DAY, 20, { unit_cost: "88.5", supplier_name: "Karachi Market", reference: "R1" })));
    expect(first).toMatchObject({ done: true, replayed: false });
    expect(first.entry).toMatchObject({ quantity: 20, unit: "strip", purchase_date: DAY, unit_cost: "88.50", supplier_name: "Karachi Market", reference: "R1", recorded_by_me: true, cancelled: false, void: null });
    await recordPurchase(a.client, parse(recordBody(panadol, DAY, 10)));
    expect(await row()).toMatchObject({ total_requested: 45, purchased: 30, remaining: 15, status: "partly_bought" });
  });

  it("returns the stored entry for a repeated request and refuses the same id with different content", async () => {
    const body = recordBody(panadol, DAY, 3);
    const first = await recordPurchase(a.client, parse(body));
    const again = await recordPurchase(a.client, parse(body));
    expect(first.replayed).toBe(false);
    expect(again.replayed).toBe(true);
    expect(again.entry.id).toBe(first.entry.id);
    const clash = await errorOf(recordPurchase(a.client, parse({ ...body, quantity: 4 })));
    expect(clash?.code).toBe("request_reused");
    expect((await row())?.purchased).toBe(33);
  });

  it("refuses invalid purchases with field messages and writes nothing", async () => {
    const before = (await row())?.purchased;
    const bad = [
      { ...recordBody(panadol, DAY, 1), quantity: 0 },
      { ...recordBody(panadol, DAY, 1), unit_cost: "12.345" },
      { ...recordBody(panadol, DAY, 1), purchase_date: addDays(todayPkt(), 1) },
    ];
    for (const body of bad) expect(RecordPurchaseBodySchema().safeParse(body).success).toBe(false);
    // The database refuses too, even when the request skips the route's own checks.
    const direct = await a.client.rpc("purchase_record", { p_id: randomUUID(), p_product: panadol, p_unit: "strip", p_date: DAY, p_quantity: 0, p_unit_cost: null, p_supplier: null, p_reference: null });
    expect(direct.data).toMatchObject({ done: false, reason: "invalid_purchase" });
    expect((await row())?.purchased).toBe(before);
  });

  it("lists the entries with their cost and the cancelled ones, newest first", async () => {
    const list = await listPurchases(a.client, { product: panadol, unit: "strip", date: DAY });
    expect(list.requested).toBe(45);
    expect(list.entries.length).toBeGreaterThanOrEqual(3);
    expect(list.entries.some((e) => e.unit_cost === "88.50")).toBe(true);
    const times = list.entries.map((e) => e.created_at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("cancels an entry with a reason: it stops counting, stays listed, and a second cancel replays", async () => {
    const entry = await recordPurchase(a.client, parse(recordBody(panadol, DAY, 7)));
    const before = (await row())!.purchased;
    const voided = await voidPurchase(a.client, entry.entry.id, VoidPurchaseBodySchema.parse({ reason: "  Typed wrongly " }));
    expect(voided).toMatchObject({ done: true, replayed: false });
    expect(voided.entry).toMatchObject({ cancelled: true, void: { reason: "Typed wrongly", by_me: true } });
    expect((await row())!.purchased).toBe(before - 7);
    const again = await voidPurchase(a.client, entry.entry.id, VoidPurchaseBodySchema.parse({ reason: "Another reason" }));
    expect(again.replayed).toBe(true);
    expect(again.entry.void?.reason).toBe("Typed wrongly");
    const list = await listPurchases(a.client, { product: panadol, unit: "strip", date: DAY });
    expect(list.entries.find((e) => e.id === entry.entry.id)?.cancelled).toBe(true);
    expect(VoidPurchaseBodySchema.safeParse({ reason: "   " }).success).toBe(false);
  });

  it("changes no order, order line, delivered quantity, price snapshot or medicine", async () => {
    const orderBefore = await getOrderWithClient(a.client, orderId);
    const productBefore = await a.client.from("products").select("*").eq("id", panadol).single();
    const entry = await recordPurchase(a.client, parse(recordBody(panadol, DAY, 2, { unit_cost: "91.00" })));
    await voidPurchase(a.client, entry.entry.id, VoidPurchaseBodySchema.parse({ reason: "Test" }));
    expect(await getOrderWithClient(a.client, orderId)).toEqual(orderBefore);
    expect((await a.client.from("products").select("*").eq("id", panadol).single()).data).toEqual(productBefore.data);
  });

  it("keeps the unit cost out of the market list", async () => {
    expect(moneyKeys(await getMarketList(a.client, ListQuerySchema().parse({ date: DAY })))).toEqual([]);
  });

  it("answers another business's medicine and entry exactly like a missing one, and changes nothing", async () => {
    const before = await row();
    const entry = await recordPurchase(a.client, parse(recordBody(panadol, DAY, 1)));
    const crafted = await errorOf(recordPurchase(b.client, parse(recordBody(panadol, DAY, 5))));
    const missing = await errorOf(recordPurchase(b.client, parse(recordBody(randomUUID(), DAY, 5))));
    expect(crafted?.code).toBe("not_found");
    expect(missing?.code).toBe("not_found");
    expect(crafted?.status).toBe(missing?.status);
    const voidCrafted = await errorOf(voidPurchase(b.client, entry.entry.id, VoidPurchaseBodySchema.parse({ reason: "Not mine" })));
    expect(voidCrafted?.code).toBe("not_found");
    expect((await listPurchases(a.client, { product: panadol, unit: "strip", date: DAY })).entries.find((e) => e.id === entry.entry.id)?.cancelled).toBe(false);
    expect((await row())!.purchased).toBe(before!.purchased + 1);
    expect((await errorOf(listPurchases(b.client, { product: panadol, unit: "strip", date: DAY })))?.code).toBe("not_found");
  });
});
