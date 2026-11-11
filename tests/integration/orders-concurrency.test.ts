import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { confirmOrder, getOrder, saveOrder } from "@/lib/orders/repository";
import { OrderActionSchema, OrderSaveSchema } from "@/lib/validation/order";
import { catalogLine, savePayload, seedWithClient, type Seeded } from "../helpers/orders";
import { createTenant, deleteTenant, hasTestEnv, serviceClient, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// Real simultaneous requests against the Supabase test project (SC-005, SC-008, SC-011): the database
// functions serialise them, so nothing is duplicated, skipped or overwritten.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const parse = (payload: ReturnType<typeof savePayload>) => OrderSaveSchema.parse(payload);

suite("order concurrency against Supabase", () => {
  let a: TestTenant;
  let seed: Seeded;
  const admin = () => serviceClient();

  beforeAll(async () => {
    a = await createTenant("orders-conc");
    seed = await seedWithClient(a.client);
  }, 60_000);
  afterAll(async () => {
    await deleteTenant(a);
  });

  it("10 simultaneous sends of the SAME first save create one order, and every send succeeds", async () => {
    const id = randomUUID();
    const body = parse(savePayload(seed.storeId, [catalogLine(seed.pricedId, 2)]));
    const results = await Promise.all(Array.from({ length: 10 }, () => saveOrder(a.client, id, body)));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.result.order.order_number)).size).toBe(1);
    expect(new Set(results.map((r) => r.result.order.version))).toEqual(new Set([1]));
    const rows = await admin().from("orders").select("id").eq("id", id);
    expect(rows.data).toHaveLength(1);
    const lines = await admin().from("order_lines").select("id").eq("order_id", id);
    expect(lines.data).toHaveLength(1);
    const events = await admin().from("order_events").select("id").eq("order_id", id);
    expect(events.data).toHaveLength(1);
  });

  it("10 simultaneous first saves with the same order id but different request ids: one wins, the rest are told it changed", async () => {
    const id = randomUUID();
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => saveOrder(a.client, id, parse(savePayload(seed.storeId, [catalogLine(seed.pricedId)])))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) {
      if (r.status === "rejected") expect((r.reason as ApiError).code).toBe("version_conflict");
    }
    const rows = await admin().from("orders").select("id").eq("id", id);
    expect(rows.data).toHaveLength(1);
  });

  it("10 simultaneous creations of different orders get 10 different consecutive numbers", async () => {
    const before = await admin().from("orders").select("order_number").eq("business_id", a.businessId);
    const start = Math.max(0, ...(before.data ?? []).map((r) => r.order_number as number));
    const results = await Promise.all(Array.from({ length: 10 }, () => saveOrder(a.client, randomUUID(), parse(savePayload(seed.storeId, [catalogLine(seed.pricedId)])))));
    const numbers = results.map((r) => r.result.order.order_number).sort((x, y) => x - y);
    expect(numbers).toEqual(Array.from({ length: 10 }, (_, i) => start + i + 1));
  });

  it("10 simultaneous confirmations of one draft give one confirmation, one history entry and one snapshot", async () => {
    const id = randomUUID();
    const created = await saveOrder(a.client, id, parse(savePayload(seed.storeId, [catalogLine(seed.pricedId, 3)])));
    const request = OrderActionSchema.parse({ request_id: randomUUID(), expected_version: created.result.order.version });
    const results = await Promise.all(Array.from({ length: 10 }, () => confirmOrder(a.client, id, request)));
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(results.every((r) => r.order.status === "confirmed")).toBe(true);
    const events = await admin().from("order_events").select("event_type").eq("order_id", id).eq("event_type", "confirmed");
    expect(events.data).toHaveLength(1);
    const order = (await getOrder(a.client, id))!;
    expect(order.version).toBe(2);
    expect(order.lines[0]).toMatchObject({ price_basis: "snapshot", selling_price: "125.50", line_total: "376.50" });
  });

  it("two saves based on the same version: one is applied, the other is refused with the current order", async () => {
    const id = randomUUID();
    const created = await saveOrder(a.client, id, parse(savePayload(seed.storeId, [catalogLine(seed.pricedId, 1)])));
    const line = created.result.order.lines[0].id;
    const attempt = (quantity: number) =>
      saveOrder(a.client, id, parse(savePayload(seed.storeId, [{ ...catalogLine(seed.pricedId, quantity), id: line }], { expected_version: 1 })));
    const settled = await Promise.allSettled([attempt(5), attempt(9)]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const refused = settled.find((s) => s.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ code: "version_conflict" });
    const winner = (settled.find((s) => s.status === "fulfilled") as PromiseFulfilledResult<{ result: { order: { lines: { quantity: number }[] } } }>).value;
    const stored = (await getOrder(a.client, id))!;
    expect(stored.lines[0].quantity).toBe(winner.result.order.lines[0].quantity); // the winner's data, not overwritten
    expect(stored.version).toBe(2);
  });

  it("a repeated update whose response was lost returns success once and changes nothing twice", async () => {
    const id = randomUUID();
    const created = await saveOrder(a.client, id, parse(savePayload(seed.storeId, [catalogLine(seed.pricedId, 1)])));
    const update = parse(savePayload(seed.storeId, [{ ...catalogLine(seed.pricedId, 4), id: created.result.order.lines[0].id }], { expected_version: 1 }));
    const first = await saveOrder(a.client, id, update);
    const retry = await saveOrder(a.client, id, update); // same request id: the response "was lost"
    expect(retry.result.replayed).toBe(true);
    expect(retry.result.order.version).toBe(first.result.order.version);
    expect((await getOrder(a.client, id))!.version).toBe(2);
  });
});
