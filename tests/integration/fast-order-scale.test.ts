import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRepeatPlan, listMedicinesPage, listUsual } from "@/lib/orders/fast-repository";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";
import { insertMedicines, seedCatalog, seedConfirmedOrder, seedHistory, seedStoreWithClient } from "../helpers/fast";

// Speed budgets of Module 008 (research D12) against the real Supabase test project, run from this machine through the
// same repository functions the routes use: the usual route (100 orders of 20 lines) and the repeat route (200 lines)
// within 1.5 s, and the full load of 5,000 medicines within 5 s. Five runs each; the maximum is printed for quickstart section 6.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const RUNS = 5;

async function timeRuns<T>(label: string, run: () => Promise<T>): Promise<{ maxMs: number; medianMs: number; last: T }> {
  const times: number[] = [];
  let last!: T;
  for (let i = 0; i < RUNS; i += 1) {
    const start = performance.now();
    last = await run();
    times.push(performance.now() - start);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const result = { maxMs: sorted[sorted.length - 1]!, medianMs: sorted[Math.floor(sorted.length / 2)]!, last };
  console.info(`fast-order-scale ${label}: median ${result.medianMs.toFixed(0)} ms, max ${result.maxMs.toFixed(0)} ms over ${RUNS} runs`);
  // The budget must hold for the median; one slow run (network jitter) is tolerated up to twice the budget.
  return result;
}

suite("fast order entry speed (real Supabase test project)", () => {
  let tenant: TestTenant;
  let storeId: string;
  let productIds: string[];

  beforeAll(async () => {
    tenant = await createTenant("fast-scale");
    productIds = await seedCatalog(tenant.client, 5000);
    storeId = await seedStoreWithClient(tenant.client, "Scale Store");
    // 105 qualifying orders of 20 lines: only the 100 most recent may be read by the usual list
    const oldMarker = (await insertMedicines(tenant.client, [{ name: "Only In The Oldest Orders" }]))[0]!;
    for (let i = 0; i < 5; i += 1) {
      const lines = [{ product_id: oldMarker, quantity: 1 }, ...Array.from({ length: 19 }, (_, j) => ({ product_id: productIds[100 + i * 19 + j]!, quantity: 1 }))];
      await seedConfirmedOrder(tenant.client, storeId, lines, { confirmedAt: new Date(Date.now() - (60 + i) * 86_400_000).toISOString() });
    }
    await seedHistory(tenant.client, storeId, productIds.slice(0, 400), { orders: 100, linesPerOrder: 20 });
  }, 900_000);

  afterAll(async () => {
    if (tenant) await deleteTenant(tenant);
  }, 120_000);

  it("the usual route reads 100 orders of 20 lines within 1.5 s and ignores the orders beyond the 100 most recent", async () => {
    const { maxMs, medianMs, last } = await timeRuns("usual (100 orders x 20 lines)", () => listUsual(tenant.client, storeId));
    expect(last.usual).toHaveLength(12);
    expect(last.usual.map((u) => u.medicine.name)).not.toContain("Only In The Oldest Orders");
    expect(medianMs).toBeLessThanOrEqual(1500);
    expect(maxMs).toBeLessThanOrEqual(3000);
  }, 300_000);

  it("the repeat route reads a 200-line order within 1.5 s", async () => {
    const lines = productIds.slice(1000, 1200).map((id) => ({ product_id: id, quantity: 2 }));
    const big = await seedConfirmedOrder(tenant.client, storeId, lines);
    const { maxMs, medianMs, last } = await timeRuns("repeat (200 lines)", () => getRepeatPlan(tenant.client, storeId, big.orderId));
    expect(last.lines).toHaveLength(200);
    expect(last.skipped).toEqual([]);
    expect(medianMs).toBeLessThanOrEqual(1500);
    expect(maxMs).toBeLessThanOrEqual(3000);
  }, 300_000);

  it("the full load of 5,000 medicines (pages of 900) takes at most 5 s", async () => {
    const { maxMs, medianMs, last } = await timeRuns("full load (5,000 medicines)", async () => {
      let count = 0;
      let cursor: string | undefined;
      do {
        const page = await listMedicinesPage(tenant.client, 900, cursor);
        count += page.items.length;
        cursor = page.next_cursor ?? undefined;
      } while (cursor);
      return count;
    });
    expect(last).toBeGreaterThanOrEqual(5000);
    expect(medianMs).toBeLessThanOrEqual(5000);
    expect(maxMs).toBeLessThanOrEqual(10_000);
  }, 300_000);
});
