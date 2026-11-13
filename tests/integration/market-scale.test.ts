import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMarketList, getMarketSummary, listPurchases, recordPurchase } from "@/lib/market/repository";
import { ListQuerySchema, RecordPurchaseBodySchema } from "@/lib/validation/market";
import { recordBody, todayPkt } from "../helpers/market";
import { seedOrderWithClient } from "../helpers/pending";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// SC-010: the market list of a day with 200 confirmed orders and 1,000 lines opens within 3 seconds, and a
// purchase save answers within 2 seconds. Run against the Supabase test project; every request is made as a real
// signed-in user. The times include the network round trip from this machine to the hosted project, but not the
// Next.js route or the browser, so they are the database's share of what a screen waits for.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const LIST_LIMIT_MS = 3_000;
const SAVE_LIMIT_MS = 2_000;
const RUNS = 5;
const TODAY = todayPkt(); // the seeded orders are confirmed now, so they belong to today's list

suite("the market list at scale", () => {
  let a: TestTenant;
  let products: string[];
  const measured: Record<string, number[]> = {};

  async function time<T>(label: string, run: () => Promise<T>): Promise<T> {
    let last!: T;
    const runs: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const start = performance.now();
      last = await run();
      runs.push(Math.round(performance.now() - start));
    }
    measured[label] = runs;
    return last;
  }

  async function inBatches<T>(items: T[], size: number, run: (item: T, index: number) => Promise<unknown>) {
    for (let i = 0; i < items.length; i += size) {
      await Promise.all(items.slice(i, i + size).map((item, j) => run(item, i + j)));
    }
  }

  beforeAll(async () => {
    a = await createTenant("market-scale");
    // 20 stores and 150 medicines
    const storeRows = Array.from({ length: 20 }, (_, i) => ({ id: randomUUID(), name: `Scale Store ${String(i).padStart(2, "0")}` }));
    const storeRes = await a.client.from("stores").insert(storeRows);
    if (storeRes.error) throw new Error(`seed stores: ${storeRes.error.message}`);
    const productRows = Array.from({ length: 150 }, (_, i) => ({ id: randomUUID(), name: `Scale Med ${String(i).padStart(3, "0")}`, unit: "strip", purchase_price: "10.00", selling_price: "15.00" }));
    for (let i = 0; i < productRows.length; i += 75) {
      const res = await a.client.from("products").insert(productRows.slice(i, i + 75));
      if (res.error) throw new Error(`seed medicines: ${res.error.message}`);
    }
    products = productRows.map((p) => p.id);

    // 200 confirmed orders of 5 lines = 1,000 lines (900 catalog lines and 100 typed lines)
    const orders = Array.from({ length: 200 }, (_, o) => o);
    await inBatches(orders, 10, (o) =>
      seedOrderWithClient(
        a.client,
        storeRows[o % 20].id,
        Array.from({ length: 5 }, (_, j) => {
          const k = o * 5 + j;
          return k % 10 === 0 ? { product_id: null, name: `Scale typed ${k % 50}`, quantity: 1 + (k % 7), unit: "strip" } : { product_id: products[k % 150], quantity: 1 + (k % 9), unit: "strip" };
        }),
        { confirm: true },
      ),
    );
    // 300 purchase entries
    const entries = Array.from({ length: 300 }, (_, i) => i);
    await inBatches(entries, 10, (i) => recordPurchase(a.client, RecordPurchaseBodySchema().parse(recordBody(products[i % 150], TODAY, 1 + (i % 4)))));
  }, 900_000);

  afterAll(async () => {
    console.info(`SC-010 measured times in ms over ${RUNS} runs each:\n${Object.entries(measured).map(([k, v]) => `  ${k}: ${v.join(", ")} (max ${Math.max(...v)})`).join("\n")}`);
    await deleteTenant(a);
  }, 300_000);

  const query = (extra: Record<string, string> = {}) => ListQuerySchema().parse({ date: TODAY, ...extra });

  it("opens the whole day's list within 3 seconds and keeps the sum rule", async () => {
    const list = await time("market list (200 orders, 1,000 lines)", () => getMarketList(a.client, query()));
    expect(list.truncated).toBe(false);
    expect(list.rows.length).toBeGreaterThan(100);
    // typed lines are every 10th line (k = 0, 10, ..., 990) with the text "Scale typed <k mod 50>": 5 different texts
    expect(list.typed_rows.length).toBe(new Set(Array.from({ length: 100 }, (_, i) => (i * 10) % 50)).size);
    const expected = Array.from({ length: 1000 }, (_, k) => 1 + (k % 10 === 0 ? k % 7 : k % 9)).reduce((s, n) => s + n, 0);
    expect(list.totals.requested).toBe(expected);
    expect(Math.max(...measured["market list (200 orders, 1,000 lines)"])).toBeLessThan(LIST_LIMIT_MS);
  }, 180_000);

  it("opens a searched, a filtered and a store-limited list within 3 seconds", async () => {
    await time("market list search", () => getMarketList(a.client, query({ q: "scale med 04" })));
    await time("market list to_buy", () => getMarketList(a.client, query({ status: "to_buy" })));
    const stores = (await getMarketList(a.client, query())).stores.slice(0, 3).map((s) => s.id).join(",");
    await time("market list 3 stores", () => getMarketList(a.client, query({ stores })));
    for (const label of ["market list search", "market list to_buy", "market list 3 stores"]) expect(Math.max(...measured[label]), label).toBeLessThan(LIST_LIMIT_MS);
  }, 180_000);

  it("gives the Home summary and a purchase history within 3 seconds", async () => {
    const summary = await time("market summary", () => getMarketSummary(a.client, TODAY));
    expect(summary.rows_total).toBeGreaterThan(100);
    const history = await time("purchase history", () => listPurchases(a.client, { product: products[0], unit: "strip", date: TODAY }));
    expect(history.entries.length).toBeGreaterThan(0);
    expect(Math.max(...measured["market summary"])).toBeLessThan(LIST_LIMIT_MS);
    expect(Math.max(...measured["purchase history"])).toBeLessThan(LIST_LIMIT_MS);
  }, 180_000);

  it("saves a purchase within 2 seconds", async () => {
    await time("purchase save", () => recordPurchase(a.client, RecordPurchaseBodySchema().parse(recordBody(products[1], TODAY, 2))));
    expect(Math.max(...measured["purchase save"])).toBeLessThan(SAVE_LIMIT_MS);
  }, 180_000);
});
