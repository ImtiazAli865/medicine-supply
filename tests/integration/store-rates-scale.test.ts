import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getOrder, listOrders, saveOrder } from "@/lib/orders/repository";
import { listAllRates, listStoreRates } from "@/lib/rates/repository";
import { OrderListQuerySchema, OrderSaveSchema } from "@/lib/validation/order";
import { seedCatalog, seedStoreWithClient } from "../helpers/fast";
import { assertTenantGone, createTenant, deleteTenant, hasTestEnv, serviceClient, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// Module 012 (T037): a store with 2,000 saved rates and an order of 200 lines, on the Supabase test project. Run alone.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const RUNS = 5;

async function median(label: string, run: () => Promise<unknown>): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const start = performance.now();
    await run();
    times.push(performance.now() - start);
  }
  const sorted = [...times].sort((a, b) => a - b);
  console.info(`store-rates-scale ${label}: median ${sorted[2]!.toFixed(0)} ms, max ${sorted[RUNS - 1]!.toFixed(0)} ms over ${RUNS} runs`);
  return sorted[2]!;
}

suite("store rates at scale (real Supabase test project)", () => {
  let tenant: TestTenant;
  let store: string;
  let order: string;

  beforeAll(async () => {
    tenant = await createTenant("rates-scale");
    const ids = await seedCatalog(tenant.client, 2000);
    store = await seedStoreWithClient(tenant.client, "Rates Scale Store");
    const rows = ids.map((product_id) => ({ business_id: tenant.businessId, store_id: store, product_id, rate: "12.50" }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await serviceClient().from("store_rates").insert(rows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }
    order = randomUUID();
    const input = OrderSaveSchema.parse({
      request_id: randomUUID(),
      expected_version: null,
      store_id: store,
      notes: null,
      lines: ids.slice(0, 200).map((product_id) => ({ id: randomUUID(), product_id, name: null, quantity: 1, unit: "strip" })),
    });
    await saveOrder(tenant.client, order, input);
  }, 900_000);

  afterAll(async () => {
    if (tenant) await deleteTenant(tenant);
    if (tenant) await assertTenantGone(tenant);
  }, 300_000);

  it("opens a 200-line draft priced from the store's rates", async () => {
    const ms = await median("order_get (200 lines)", () => getOrder(tenant.client, order));
    expect((await getOrder(tenant.client, order))!.lines.every((l) => l.price_source === "store_rate")).toBe(true);
    expect(ms).toBeLessThanOrEqual(2500);
  }, 120_000);

  it("lists orders with the same price rule", async () => {
    const ms = await median("order_list", () => listOrders(tenant.client, OrderListQuerySchema.parse({})));
    expect(ms).toBeLessThanOrEqual(2500);
  }, 120_000);

  it("reads one store's 2,000 rates and the whole copy for the phone", async () => {
    const one = await median("store rates list (2,000)", () => listStoreRates(tenant.client, store));
    const all = await median("phone copy (3 pages)", async () => {
      let cursor: string | undefined;
      let count = 0;
      do {
        const page = await listAllRates(tenant.client, 900, cursor);
        count += page.items.length;
        cursor = page.next_cursor ?? undefined;
      } while (cursor);
      expect(count).toBe(2000);
    });
    expect(one).toBeLessThanOrEqual(5000);
    expect(all).toBeLessThanOrEqual(5000);
  }, 120_000);
});
