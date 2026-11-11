import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { cancelOrder, confirmOrder, getOrder, listOrders, saveOrder } from "@/lib/orders/repository";
import { OrderActionSchema, OrderCancelSchema, OrderListQuerySchema, OrderSaveSchema } from "@/lib/validation/order";
import { catalogLine, savePayload, seedWithClient, type Seeded } from "../helpers/orders";
import { anonClient, createTenant, deleteTenant, hasTestEnv, serviceClient, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// Isolation of orders, lines, history and order numbers between two real businesses (SC-006), on the
// Supabase test project. Every request is made as a real signed-in user, so RLS is in effect.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const parse = (payload: ReturnType<typeof savePayload>) => OrderSaveSchema.parse(payload);
const errorOf = async (promise: Promise<unknown>) => (await promise.then(() => null, (e) => e)) as ApiError | null;

suite("Module 003 isolation against Supabase", () => {
  let a: TestTenant;
  let b: TestTenant;
  let seedA: Seeded;
  let seedB: Seeded;
  let orderB: string;
  let lineB: string;

  beforeAll(async () => {
    a = await createTenant("rls3-a");
    b = await createTenant("rls3-b");
    seedA = await seedWithClient(a.client);
    seedB = await seedWithClient(b.client, "B Pharmacy");
    orderB = randomUUID();
    const created = await saveOrder(b.client, orderB, parse(savePayload(seedB.storeId, [catalogLine(seedB.pricedId, 2)], { notes: "B's private note" })));
    lineB = created.result.order.lines[0].id;
    await saveOrder(a.client, randomUUID(), parse(savePayload(seedA.storeId, [catalogLine(seedA.pricedId)])));
  }, 60_000);
  afterAll(async () => {
    await deleteTenant(a);
    await deleteTenant(b);
  });

  it("each business reads only its own orders, lines and history, directly and through the functions", async () => {
    for (const table of ["orders", "order_lines", "order_events"]) {
      const res = await a.client.from(table).select("business_id");
      expect(res.error).toBeNull();
      expect(res.data!.length, table).toBeGreaterThan(0);
      expect(new Set(res.data!.map((r) => r.business_id as string)), table).toEqual(new Set([a.businessId]));
    }
    expect(await getOrder(a.client, orderB)).toBeNull();
    const list = await listOrders(a.client, OrderListQuerySchema.parse({}));
    expect(list.items.map((o) => o.id)).not.toContain(orderB);
    expect(JSON.stringify(list)).not.toMatch(/B's private|B Pharmacy/);
  });

  it("cannot save, confirm or cancel another business's order, and leaves it untouched", async () => {
    const before = (await getOrder(b.client, orderB))!;
    const attempt = parse(savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId, 99), id: lineB }], { expected_version: before.version }));
    expect(await errorOf(saveOrder(a.client, orderB, attempt))).toMatchObject({ code: "not_found" });
    expect(await errorOf(saveOrder(a.client, orderB, { ...attempt, expected_version: null }))).toMatchObject({ code: "validation_error" });
    expect(await errorOf(confirmOrder(a.client, orderB, OrderActionSchema.parse({ request_id: randomUUID(), expected_version: before.version })))).toMatchObject({ code: "not_found" });
    expect(await errorOf(cancelOrder(a.client, orderB, OrderCancelSchema.parse({ request_id: randomUUID(), expected_version: before.version, reason: "hostile" })))).toMatchObject({ code: "not_found" });
    expect(await getOrder(b.client, orderB)).toEqual(before);
  });

  it("refuses another business's store, medicine and line id inside a payload, and changes nothing there", async () => {
    expect(await errorOf(saveOrder(a.client, randomUUID(), parse(savePayload(seedB.storeId, []))))).toMatchObject({ code: "validation_error" });
    expect(await errorOf(saveOrder(a.client, randomUUID(), parse(savePayload(seedA.storeId, [catalogLine(seedB.pricedId)]))))).toMatchObject({ code: "validation_error" });
    const mine = randomUUID();
    const created = await saveOrder(a.client, mine, parse(savePayload(seedA.storeId, [catalogLine(seedA.pricedId)])));
    const foreignLine = { ...catalogLine(seedA.pricedId), id: lineB };
    expect(await errorOf(saveOrder(a.client, mine, parse(savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId), id: created.result.order.lines[0].id }, foreignLine], { expected_version: 1 }))))).toMatchObject({ code: "validation_error" });
    const stolen = await serviceClient().from("order_lines").select("order_id").eq("id", lineB).single();
    expect(stolen.data!.order_id).toBe(orderB);
  });

  it("numbers orders independently per business, and nothing of one business changes the other's counter", async () => {
    const counters = await serviceClient().from("order_counters").select("business_id, last_number").in("business_id", [a.businessId!, b.businessId!]);
    expect(counters.data).toHaveLength(2);
    const bBefore = counters.data!.find((c) => c.business_id === b.businessId)!.last_number as number;
    await saveOrder(a.client, randomUUID(), parse(savePayload(seedA.storeId, [])));
    const after = await serviceClient().from("order_counters").select("last_number").eq("business_id", b.businessId!).single();
    expect(after.data!.last_number).toBe(bBefore);
  });

  it("gives a signed-out visitor nothing", async () => {
    const anon = anonClient();
    const direct = await anon.from("orders").select("*");
    expect(direct.error !== null || (direct.data ?? []).length === 0).toBe(true);
    const viaFunction = await anon.rpc("order_get", { p_id: orderB });
    expect(viaFunction.error).not.toBeNull();
    const save = await anon.rpc("order_save", { p_id: randomUUID(), p_request_id: randomUUID(), p_expected_version: null, p_store_id: seedA.storeId, p_notes: null, p_lines: [] });
    expect(save.error).not.toBeNull();
  });
});
