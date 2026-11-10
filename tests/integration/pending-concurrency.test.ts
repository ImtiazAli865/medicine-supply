import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { registerLine } from "@/lib/pending/repository";
import { RegisterBodySchema } from "@/lib/validation/pending";
import { getOrderWithClient, registerBody, seedMedicineWithClient, seedOrderWithClient, seedStoreWithClient } from "../helpers/pending";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// Simultaneous requests through separate connections to the real Supabase test project: this is where the
// advisory locks and the idempotency table are proven, not only on one in-memory connection.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

suite("pending products under simultaneous requests", () => {
  let a: TestTenant;
  let storeA: string;

  beforeAll(async () => {
    a = await createTenant("pending-conc");
    storeA = await seedStoreWithClient(a.client);
  }, 60_000);
  afterAll(async () => {
    await deleteTenant(a);
  });

  async function typedOrder(typedName: string) {
    const catalog = await seedMedicineWithClient(a.client, { name: `Catalog ${randomUUID().slice(0, 6)}`, unit: "box" });
    const order = await seedOrderWithClient(a.client, storeA, [{ product_id: null, name: typedName, quantity: 3, unit: "strip" }, { product_id: catalog, quantity: 2, unit: "box" }], { confirm: true });
    return { ...order, typedId: order.lineIds[0] };
  }

  const medicinesNamed = async (name: string) => (await a.client.from("products").select("id").eq("name", name)).data ?? [];

  it("gives 10 simultaneous identical register requests one medicine, one link and the same result", async () => {
    const o = await typedOrder("Concurrent Noran");
    const body = RegisterBodySchema.parse(registerBody(o.version, { name: "Concurrent Noran" }));
    const results = await Promise.all(Array.from({ length: 10 }, () => registerLine(a.client, o.orderId, o.typedId, body)));
    expect(results.filter((r) => r.replayed === false)).toHaveLength(1);
    expect(results.filter((r) => r.replayed === true)).toHaveLength(9);
    expect(new Set(results.map((r) => r.product.id)).size).toBe(1);
    expect(new Set(results.map((r) => r.order.lines[0].product_id)).size).toBe(1);
    expect(await medicinesNamed("Concurrent Noran")).toHaveLength(1);
    const order = await getOrderWithClient(a.client, o.orderId);
    expect(order.events.filter((e) => e.event_type === "linked")).toHaveLength(1);
    expect(order.version).toBe(o.version + 1);
  }, 120_000);

  it("lets exactly one of 10 different requests for the same line win, and never leaves a half-linked line", async () => {
    const o = await typedOrder("Race Noran");
    const settled = await Promise.allSettled(
      Array.from({ length: 10 }, () => registerLine(a.client, o.orderId, o.typedId, RegisterBodySchema.parse(registerBody(o.version, { name: "Race Noran", unit: "strip" })))),
    );
    const won = settled.filter((s) => s.status === "fulfilled");
    const lost = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
    expect(won).toHaveLength(1);
    for (const l of lost) {
      expect(l.reason).toBeInstanceOf(ApiError);
      expect(["version_conflict", "line_not_pending", "duplicate_product"]).toContain((l.reason as ApiError).code);
    }
    expect(await medicinesNamed("Race Noran")).toHaveLength(1);
    const order = await getOrderWithClient(a.client, o.orderId);
    expect(order.lines[0].product_id).toBe((await medicinesNamed("Race Noran"))[0].id);
    expect(order.events.filter((e) => e.event_type === "linked")).toHaveLength(1);
  }, 120_000);
});
