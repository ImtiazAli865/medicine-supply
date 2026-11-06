import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { cancelOrder, confirmOrder, getOrder, saveOrder } from "@/lib/orders/repository";
import { OrderActionSchema, OrderCancelSchema, OrderSaveSchema } from "@/lib/validation/order";
import { catalogLine, savePayload, seedWithClient, typedLine, type Seeded } from "../helpers/orders";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// Editing and cancelling a confirmed order through the real stack, two sessions, and the proof that the
// order tables cannot be changed or deleted by a signed-in user directly (SC-011, SC-014).
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const parse = (payload: ReturnType<typeof savePayload>) => OrderSaveSchema.parse(payload);
const errorOf = async (promise: Promise<unknown>) => (await promise.then(() => null, (e) => e)) as ApiError | null;

suite("editing and cancelling orders against Supabase", () => {
  let a: TestTenant;
  let seed: Seeded;

  beforeAll(async () => {
    a = await createTenant("orders-edit");
    seed = await seedWithClient(a.client);
  }, 60_000);
  afterAll(async () => {
    await deleteTenant(a);
  });

  async function confirmed(lines: ReturnType<typeof catalogLine>[]) {
    const id = randomUUID();
    const created = await saveOrder(a.client, id, parse(savePayload(seed.storeId, lines)));
    const done = await confirmOrder(a.client, id, OrderActionSchema.parse({ request_id: randomUUID(), expected_version: created.result.order.version }));
    return { id, order: done.order };
  }

  it("edits a confirmed order in place: snapshot kept, new line priced now, removed line recorded, history written", async () => {
    const { id, order } = await confirmed([catalogLine(seed.pricedId, 3), typedLine("Typed", 1, "box")]);
    const priced = order.lines[0];
    const res = await saveOrder(
      a.client,
      id,
      parse(savePayload(seed.storeId, [{ ...catalogLine(seed.pricedId, 4), id: priced.id }, catalogLine(seed.sellingOnlyId, 2, "box")], { expected_version: order.version, notes: "edited" })),
    );
    expect(res.result.order).toMatchObject({ status: "confirmed", version: order.version + 1, notes: "edited" });
    expect(res.result.order.lines[0]).toMatchObject({ quantity: 4, selling_price: "125.50", line_total: "502.00" });
    expect(res.result.order.lines[1]).toMatchObject({ name: "Brufen 400mg", price_basis: "snapshot", selling_price: "310.00", line_total: "620.00" });
    const edited = res.result.order.events[0];
    expect(edited.event_type).toBe("edited");
    const changes = (edited.detail as { edited: { changes: { type: string }[] } }).edited.changes.map((c) => c.type);
    expect(changes).toEqual(["quantity", "added", "removed", "notes"]);
    expect(JSON.stringify(res.result.order.events)).not.toMatch(/purchase|mrp/i);
  });

  it("two sessions editing the same confirmed order: the second save is refused and nothing is overwritten", async () => {
    const { id, order } = await confirmed([catalogLine(seed.pricedId, 2)]);
    const line = order.lines[0].id;
    const edit = (quantity: number) => parse(savePayload(seed.storeId, [{ ...catalogLine(seed.pricedId, quantity), id: line }], { expected_version: order.version }));
    await saveOrder(a.client, id, edit(5)); // the first tab saves
    const second = await errorOf(saveOrder(a.client, id, edit(8))); // the second tab is still on the old version
    expect(second).toMatchObject({ code: "version_conflict", status: 409 });
    expect((second!.current as { lines: { quantity: number }[] }).lines[0].quantity).toBe(5);
    expect((await getOrder(a.client, id))!.lines[0].quantity).toBe(5);
  });

  it("cancels with a reason, keeps lines and prices, and makes the order read-only", async () => {
    const { id, order } = await confirmed([catalogLine(seed.pricedId, 2)]);
    const cancelled = await cancelOrder(a.client, id, OrderCancelSchema.parse({ request_id: randomUUID(), expected_version: order.version, reason: "Pharmacy cancelled by phone" }));
    expect(cancelled.order).toMatchObject({ status: "cancelled", cancel_reason: "Pharmacy cancelled by phone" });
    expect(cancelled.order.lines).toEqual(order.lines);
    expect(cancelled.order.events[0].event_type).toBe("cancelled");
    expect(await errorOf(saveOrder(a.client, id, parse(savePayload(seed.storeId, [], { expected_version: cancelled.order.version }))))).toMatchObject({ code: "order_not_editable" });
    expect(await errorOf(confirmOrder(a.client, id, OrderActionSchema.parse({ request_id: randomUUID(), expected_version: cancelled.order.version })))).toMatchObject({ code: "order_not_editable" });
  });

  it("refuses every direct write to the order tables by a signed-in user (no hard delete, no edit of history)", async () => {
    const { id } = await confirmed([catalogLine(seed.pricedId, 1)]);
    const attempts = await Promise.all([
      a.client.from("orders").delete().eq("id", id),
      a.client.from("orders").update({ notes: "hacked" }).eq("id", id),
      a.client.from("orders").insert({ id: randomUUID(), store_id: seed.storeId, order_number: 99999 }),
      a.client.from("order_lines").delete().eq("order_id", id),
      a.client.from("order_lines").update({ quantity: 99 }).eq("order_id", id),
      a.client.from("order_events").delete().eq("order_id", id),
      a.client.from("order_events").update({ detail: {} }).eq("order_id", id),
      a.client.from("order_events").insert({ order_id: id, event_type: "created", order_version: 1 }),
      a.client.from("order_counters").select("*"),
    ]);
    for (const [i, result] of attempts.entries()) expect(result.error, `attempt ${i}`).not.toBeNull();
    const order = (await getOrder(a.client, id))!;
    expect(order.notes).toBeNull();
    expect(order.lines).toHaveLength(1);
    expect(order.events).toHaveLength(2);
  });
});
