import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { cancelOrder, confirmOrder, getOrder, saveOrder } from "@/lib/orders/repository";
import { OrderActionSchema, OrderCancelSchema, OrderSaveSchema } from "@/lib/validation/order";
import { catalogLine, savePayload, seedWithClient, typedLine, type Seeded } from "../helpers/orders";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// The order repository (the code behind /api/orders) against a real Supabase test project, signed in as
// real users so Row Level Security and the database functions are in effect. Skipped without credentials.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const errorOf = async (promise: Promise<unknown>) => (await promise.then(() => null, (e) => e)) as ApiError | null;
const parse = (payload: ReturnType<typeof savePayload>) => OrderSaveSchema.parse(payload);
const action = (version: number) => OrderActionSchema.parse({ request_id: randomUUID(), expected_version: version });

suite("orders repository against Supabase", () => {
  let a: TestTenant;
  let b: TestTenant;
  let seedA: Seeded;
  let seedB: Seeded;

  beforeAll(async () => {
    a = await createTenant("orders-a");
    b = await createTenant("orders-b");
    seedA = await seedWithClient(a.client);
    seedB = await seedWithClient(b.client, "B Pharmacy");
  }, 60_000);
  afterAll(async () => {
    await deleteTenant(a);
    await deleteTenant(b);
  });

  it("creates a draft (created), and repeating the same request returns the stored order (replayed)", async () => {
    const id = randomUUID();
    const body = parse(savePayload(seedA.storeId, [catalogLine(seedA.pricedId, 2)], { notes: "first" }));
    const first = await saveOrder(a.client, id, body);
    expect(first.created).toBe(true);
    expect(first.result.replayed).toBe(false);
    expect(first.result.order).toMatchObject({ id, status: "draft", version: 1, notes: "first", store: { id: seedA.storeId } });
    expect(first.result.order.order_number).toBeGreaterThan(0);

    const again = await saveOrder(a.client, id, body);
    expect(again.created).toBe(false);
    expect(again.result.replayed).toBe(true);
    expect(again.result.order.order_number).toBe(first.result.order.order_number);
    expect(again.result.order.version).toBe(1);
  });

  it("reads an order with its lines and totals, and never exposes purchase price or MRP", async () => {
    const id = randomUUID();
    await saveOrder(a.client, id, parse(savePayload(seedA.storeId, [catalogLine(seedA.pricedId, 2), typedLine("Unknown Syrup", 1, "box")])));
    const order = (await getOrder(a.client, id))!;
    expect(order.lines.map((l) => l.name)).toEqual(["Panadol 500mg", "Unknown Syrup"]);
    expect(order.totals).toMatchObject({ priced_total: "251.00", priced_lines: 1, unpriced_lines: 1, line_count: 2 });
    expect(JSON.stringify(order)).not.toMatch(/purchase|mrp|business_id/i);
  });

  it("confirms an order, and a repeated confirmation returns the original", async () => {
    const id = randomUUID();
    const created = await saveOrder(a.client, id, parse(savePayload(seedA.storeId, [catalogLine(seedA.pricedId, 3)])));
    const confirmed = await confirmOrder(a.client, id, action(created.result.order.version));
    expect(confirmed.replayed).toBe(false);
    expect(confirmed.order).toMatchObject({ status: "confirmed", version: 2 });
    const again = await confirmOrder(a.client, id, action(1));
    expect(again.replayed).toBe(true);
    expect(again.order.version).toBe(2);
  });

  it("answers not found for an unknown order and for another business's order", async () => {
    expect(await getOrder(a.client, randomUUID())).toBeNull();
    const bOrder = randomUUID();
    await saveOrder(b.client, bOrder, parse(savePayload(seedB.storeId, [catalogLine(seedB.pricedId)])));
    expect(await getOrder(a.client, bOrder)).toBeNull();
    expect(await errorOf(confirmOrder(a.client, bOrder, action(1)))).toMatchObject({ code: "not_found", status: 404 });
    expect(await errorOf(cancelOrder(a.client, bOrder, OrderCancelSchema.parse({ ...action(1), reason: "x" })))).toMatchObject({ code: "not_found" });
  });

  it("maps refusals to the documented errors", async () => {
    const id = randomUUID();
    const { result } = await saveOrder(a.client, id, parse(savePayload(seedA.storeId, [catalogLine(seedA.pricedId)])));
    const line = result.order.lines[0].id;

    // version conflict carries the current order
    const stale = await errorOf(saveOrder(a.client, id, parse(savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId, 9), id: line }], { expected_version: 7 }))));
    expect(stale).toMatchObject({ code: "version_conflict", status: 409 });
    expect((stale!.current as { version: number }).version).toBe(1);

    // the store is locked once the order has a line
    const second = randomUUID();
    await a.client.from("stores").insert({ id: second, name: "Another Store" });
    const locked = await errorOf(saveOrder(a.client, id, parse(savePayload(second, [{ ...catalogLine(seedA.pricedId), id: line }], { expected_version: 1 }))));
    expect(locked).toMatchObject({ code: "store_locked", status: 409 });

    // another business's store and medicine are validation errors on the right field
    expect(await errorOf(saveOrder(a.client, randomUUID(), parse(savePayload(seedB.storeId, []))))).toMatchObject({ code: "validation_error", fields: { store_id: expect.any(String) } });
    expect(await errorOf(saveOrder(a.client, randomUUID(), parse(savePayload(seedA.storeId, [catalogLine(seedB.pricedId)]))))).toMatchObject({ code: "validation_error", fields: { lines: expect.any(String) } });

    // an inactive store cannot start a new order
    await a.client.from("stores").update({ is_active: false }).eq("id", second);
    expect(await errorOf(saveOrder(a.client, randomUUID(), parse(savePayload(second, []))))).toMatchObject({ code: "validation_error", fields: { store_id: expect.any(String) } });

    // an empty draft cannot be confirmed; a confirmed order needs a reason to be cancelled
    const empty = randomUUID();
    await saveOrder(a.client, empty, parse(savePayload(seedA.storeId, [])));
    expect(await errorOf(confirmOrder(a.client, empty, action(1)))).toMatchObject({ code: "order_empty", status: 409 });
    const confirmed = await confirmOrder(a.client, id, action(1));
    expect(await errorOf(cancelOrder(a.client, id, OrderCancelSchema.parse({ ...action(confirmed.order.version), reason: "   " })))).toMatchObject({ code: "validation_error", fields: { reason: expect.any(String) } });

    // a cancelled order can no longer be saved
    const cancelled = await cancelOrder(a.client, id, OrderCancelSchema.parse({ ...action(confirmed.order.version), reason: "Pharmacy cancelled" }));
    expect(cancelled.order).toMatchObject({ status: "cancelled", cancel_reason: "Pharmacy cancelled" });
    expect(await errorOf(saveOrder(a.client, id, parse(savePayload(seedA.storeId, [], { expected_version: cancelled.order.version }))))).toMatchObject({ code: "order_not_editable", status: 409 });
  });

  it("an order id that belongs to another business is an unusable id, revealing nothing", async () => {
    const bOrder = randomUUID();
    await saveOrder(b.client, bOrder, parse(savePayload(seedB.storeId, [])));
    expect(await errorOf(saveOrder(a.client, bOrder, parse(savePayload(seedA.storeId, []))))).toMatchObject({ code: "validation_error", fields: { id: expect.any(String) } });
  });
});
