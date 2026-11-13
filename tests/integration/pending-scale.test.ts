import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyPriceFill, listPendingPrices, listTypedGroups, pendingCandidates, pendingSummary, previewPriceFill } from "@/lib/pending/repository";
import { PendingListQuerySchema, PriceApplyBodySchema } from "@/lib/validation/pending";
import { seedOrderWithClient, seedStoreWithClient } from "../helpers/pending";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// SC-011: with 1,000 typed or waiting lines and 500 medicines without a price, each pending screen's data opens
// within 2 seconds. Run against the Supabase test project; every request is made as a real signed-in user.
// The times include the network round trip from this machine to the hosted project, but not the Next.js route
// or the browser, so they are the database's share of what a screen waits for.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const LIMIT_MS = 2_000;
const RUNS = 5;

suite("pending screens at scale", () => {
  let a: TestTenant;
  let storeId: string;
  let waitingProduct: string;
  let sameTextProduct: string;
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

  beforeAll(async () => {
    a = await createTenant("scale-a");
    storeId = await seedStoreWithClient(a.client);

    // 500 medicines without a price (batches of 100), plus the two medicines the checks below use
    const rows = Array.from({ length: 500 }, (_, i) => ({ id: randomUUID(), name: `Scale Med ${String(i).padStart(3, "0")}`, unit: "strip" }));
    for (let i = 0; i < rows.length; i += 100) {
      const res = await a.client.from("products").insert(rows.slice(i, i + 100));
      if (res.error) throw new Error(`seed medicines: ${res.error.message}`);
    }
    waitingProduct = randomUUID();
    sameTextProduct = randomUUID();
    const extra = await a.client.from("products").insert([
      { id: waitingProduct, name: "Scale Waiting", unit: "strip" },
      { id: sameTextProduct, name: "Scale Same", unit: "strip" },
    ]);
    if (extra.error) throw new Error(`seed medicines: ${extra.error.message}`);

    // 1,000 typed lines (5 confirmed orders of 200; 250 of them carry the same text) ...
    for (let order = 0; order < 5; order += 1) {
      const lines = Array.from({ length: 200 }, (_, i) =>
        i < 150 ? { product_id: null, name: `Scale Typed ${order * 150 + i}`, quantity: 1, unit: "strip" } : { product_id: null, name: "Scale Same", quantity: 1, unit: "strip" },
      );
      await seedOrderWithClient(a.client, storeId, lines, { confirm: true });
    }
    // ... and 1,000 confirmed lines of one medicine that has no price (5 orders of 200)
    for (let order = 0; order < 5; order += 1) {
      await seedOrderWithClient(a.client, storeId, Array.from({ length: 200 }, () => ({ product_id: waitingProduct, quantity: 1, unit: "strip" })), { confirm: true });
    }
  }, 600_000);

  afterAll(async () => {
    console.info(`SC-011 measured times in ms over ${RUNS} runs each:\n${Object.entries(measured).map(([k, v]) => `  ${k}: ${v.join(", ")} (max ${Math.max(...v)})`).join("\n")}`);
    await deleteTenant(a);
  }, 300_000);

  const query = (q = "", limit = "50") => PendingListQuerySchema.parse({ q, limit });

  it("the summary is right and opens within 2 seconds", async () => {
    const summary = await time("summary", () => pendingSummary(a.client));
    expect(summary).toMatchObject({ typed_lines: 1000, typed_groups: 751, lines_waiting: 1000 });
    // 502 unpriced medicines (500 + Scale Waiting + Scale Same); Scale Waiting is the only one with waiting lines
    expect(summary.price_items).toBe(502);
    expect(summary.price_items_with_waiting_lines).toBe(1);
    expect(Math.max(...measured.summary)).toBeLessThan(LIMIT_MS);
  }, 120_000);

  it("the Need a price list (first page, a search, the last page) opens within 2 seconds", async () => {
    const first = await time("prices first page", () => listPendingPrices(a.client, query()));
    expect(first.items).toHaveLength(50);
    expect(first.items[0].product_id).toBe(waitingProduct); // most waiting lines first
    expect(first.items[0].lines_waiting).toBe(1000);
    expect(first.next_cursor).toBe("50");
    const searched = await time("prices search", () => listPendingPrices(a.client, query("scale med 42")));
    expect(searched.items.length).toBeGreaterThan(0);
    const last = await time("prices last page", () => listPendingPrices(a.client, PendingListQuerySchema.parse({ q: "", limit: "50", cursor: "500" })));
    expect(last.items).toHaveLength(2);
    expect(last.next_cursor).toBeNull();
    for (const label of ["prices first page", "prices search", "prices last page"]) expect(Math.max(...measured[label]), label).toBeLessThan(LIMIT_MS);
  }, 120_000);

  it("the To register list (first page, a search, a late page) opens within 2 seconds", async () => {
    const first = await time("typed first page", () => listTypedGroups(a.client, query()));
    expect(first.items).toHaveLength(50);
    const same = await time("typed search", () => listTypedGroups(a.client, query("scale same")));
    expect(same.items).toHaveLength(1);
    expect(same.items[0].line_count).toBe(250);
    const late = await time("typed late page", () => listTypedGroups(a.client, PendingListQuerySchema.parse({ q: "", limit: "50", cursor: "700" })));
    expect(late.items.length).toBeGreaterThan(0);
    for (const label of ["typed first page", "typed search", "typed late page"]) expect(Math.max(...measured[label]), label).toBeLessThan(LIMIT_MS);
  }, 120_000);

  it("the proposals for a medicine with 250 matching lines open within 2 seconds and are capped", async () => {
    const res = await time("candidates", () => pendingCandidates(a.client, sameTextProduct));
    expect(res.proposed).toHaveLength(200); // the cap per group
    expect(Math.max(...measured.candidates)).toBeLessThan(LIMIT_MS);
  }, 120_000);

  it("the price review of 1,000 waiting lines opens within 2 seconds, and the fill covers them all or nothing", async () => {
    const preview = await time("price preview (1,000 lines)", () => previewPriceFill(a.client, waitingProduct, "10.00"));
    expect(preview.lines).toHaveLength(1000);
    expect(preview.total_waiting).toBe(1000);
    expect(Math.max(...measured["price preview (1,000 lines)"])).toBeLessThan(LIMIT_MS);

    // the fill itself is a write of 1,000 lines and 5 history entries in one transaction: time it once
    const start = performance.now();
    const res = await applyPriceFill(a.client, waitingProduct, PriceApplyBodySchema.parse({ request_id: randomUUID(), price: "10.00", line_ids: preview.lines.map((l) => l.line_id), fill_lines: true }));
    measured["price fill (1,000 lines, once)"] = [Math.round(performance.now() - start)];
    expect(res).toMatchObject({ filled_count: 1000, orders_touched: 5 });
    expect(measured["price fill (1,000 lines, once)"][0]).toBeLessThan(15_000);
    expect((await previewPriceFill(a.client, waitingProduct, "10.00")).total_waiting).toBe(0);
  }, 180_000);
});
