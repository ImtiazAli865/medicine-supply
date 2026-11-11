import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { confirmOrder, getOrder, saveOrder } from "@/lib/orders/repository";
import { OrderActionSchema, OrderSaveSchema } from "@/lib/validation/order";
import { catalogLine, savePayload, seedWithClient, typedLine, type Seeded } from "../helpers/orders";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// Price snapshots through the real stack (SC-004, SC-007, SC-013), changing the catalog the way the app does.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const parse = (payload: ReturnType<typeof savePayload>) => OrderSaveSchema.parse(payload);

suite("order prices against Supabase", () => {
  let a: TestTenant;
  let seed: Seeded;

  beforeAll(async () => {
    a = await createTenant("orders-prices");
    seed = await seedWithClient(a.client);
  }, 60_000);
  afterAll(async () => {
    await deleteTenant(a);
  });

  const setPrice = async (productId: string, price: string | null) => {
    const { error } = await a.client.from("products").update({ selling_price: price }).eq("id", productId);
    expect(error).toBeNull();
  };

  it("keeps a confirmed order's prices and totals unchanged when the catalog price changes afterwards", async () => {
    const id = randomUUID();
    const created = await saveOrder(a.client, id, parse(savePayload(seed.storeId, [catalogLine(seed.pricedId, 3), catalogLine(seed.noPriceId, 2, "bottle")])));
    const confirmed = await confirmOrder(a.client, id, OrderActionSchema.parse({ request_id: randomUUID(), expected_version: created.result.order.version }));
    await setPrice(seed.pricedId, "999.00");
    await setPrice(seed.noPriceId, "55.00"); // a price added later must not appear on the old order
    const after = (await getOrder(a.client, id))!;
    expect(after.lines).toEqual(confirmed.order.lines);
    expect(after.lines[0]).toMatchObject({ price_basis: "snapshot", selling_price: "125.50", line_total: "376.50" });
    expect(after.lines[1]).toMatchObject({ price_basis: "none", selling_price: null, line_total: null });
    expect(after.totals).toEqual(confirmed.order.totals);
    await setPrice(seed.pricedId, "125.50");
    await setPrice(seed.noPriceId, null);
  });

  it("shows a draft's current catalog price and follows it until the order is confirmed", async () => {
    const id = randomUUID();
    await saveOrder(a.client, id, parse(savePayload(seed.storeId, [catalogLine(seed.pricedId, 2)])));
    expect((await getOrder(a.client, id))!.lines[0]).toMatchObject({ price_basis: "current", selling_price: "125.50", line_total: "251.00" });
    await setPrice(seed.pricedId, "130.00");
    expect((await getOrder(a.client, id))!.lines[0]).toMatchObject({ price_basis: "current", selling_price: "130.00", line_total: "260.00" });
    await setPrice(seed.pricedId, "125.50");
  });

  it("totals only the priced lines and counts the unpriced ones (typed lines too)", async () => {
    const id = randomUUID();
    await saveOrder(a.client, id, parse(savePayload(seed.storeId, [catalogLine(seed.pricedId, 2), catalogLine(seed.sellingOnlyId, 1, "box"), catalogLine(seed.noPriceId, 4, "bottle"), typedLine("Typed Item", 3)])));
    const order = (await getOrder(a.client, id))!;
    expect(order.totals).toEqual({ priced_total: "561.00", priced_lines: 2, unpriced_lines: 2, line_count: 4 });
  });

  it("confirms an order with unpriced and typed lines without any block, and invents no price", async () => {
    const id = randomUUID();
    const created = await saveOrder(a.client, id, parse(savePayload(seed.storeId, [catalogLine(seed.noPriceId, 1, "bottle"), typedLine("Only Typed", 2)])));
    const confirmed = await confirmOrder(a.client, id, OrderActionSchema.parse({ request_id: randomUUID(), expected_version: created.result.order.version }));
    expect(confirmed.order.status).toBe("confirmed");
    for (const line of confirmed.order.lines) expect(line).toMatchObject({ price_basis: "none", selling_price: null, line_total: null });
    expect(confirmed.order.totals).toMatchObject({ priced_total: "0.00", priced_lines: 0, unpriced_lines: 2 });
  });

  it("never returns purchase price or MRP at any depth of any order response", async () => {
    const id = randomUUID();
    const created = await saveOrder(a.client, id, parse(savePayload(seed.storeId, [catalogLine(seed.pricedId, 1)])));
    const confirmed = await confirmOrder(a.client, id, OrderActionSchema.parse({ request_id: randomUUID(), expected_version: created.result.order.version }));
    for (const response of [created.result, confirmed, await getOrder(a.client, id)]) {
      expect(JSON.stringify(response)).not.toMatch(/purchase|mrp|90\.00|130\.00/i);
    }
  });
});
