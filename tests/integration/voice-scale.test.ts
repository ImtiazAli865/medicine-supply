import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveOrder } from "@/lib/orders/repository";
import { OrderSaveSchema } from "@/lib/validation/order";
import { matchProducts, matchStores } from "@/lib/voice/repository";
import { parseTranscript } from "@/lib/voice/service";
import { catalogLine, savePayload } from "../helpers/orders";
import { createTenant, deleteTenant, hasTestEnv, serviceClient, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";
import { nearSpelling, scaleMedicine, scaleStoreName } from "../helpers/scale-catalog";
import { FakeParser, rawItem, rawParse } from "../helpers/voice";

// Success criterion SC-009 on the real Supabase test project: with 5,000 medicines and 100 stores, matching a 200-item
// parse result (the preview) and creating a 200-line voice draft each finish within 2 seconds. Every timing includes the
// network between this machine and the test project. The AI is a fake. The service key is used here only to seed in bulk.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const GOAL_MS = 2000;
const RUNS = 5;
const MEDICINES = 5000;
const STORES = 100;
const ITEMS = 200;
const STATS_WAIT_MS = 100_000;

const medicineName = (n: number) => scaleMedicine(n).name;
const storeName = scaleStoreName;
// 3 of every 4 spoken names are exact catalog names and every fourth is a near spelling (similar, never exact)
const spokenNames = () => Array.from({ length: ITEMS }, (_, i) => (i % 4 === 0 ? nearSpelling(medicineName(1 + i * 24)) : medicineName(1 + i * 24)));

suite("voice at scale against Supabase", () => {
  let a: TestTenant;
  let productIds: string[] = [];
  let firstMs = 0;
  const previewMs: number[] = [];
  const matchMs: number[] = [];
  const createMs: number[] = [];

  beforeAll(async () => {
    a = await createTenant("voice-scale");
    const admin = serviceClient();
    const stores = Array.from({ length: STORES }, (_, i) => ({ id: randomUUID(), business_id: a.businessId, name: storeName(i + 1) }));
    const addStores = await admin.from("stores").insert(stores);
    if (addStores.error) throw new Error(`seed stores: ${addStores.error.message}`);
    const products = Array.from({ length: MEDICINES }, (_, i) => {
      const m = scaleMedicine(i);
      return { id: randomUUID(), business_id: a.businessId, name: m.name, brand: m.brand, unit: "strip", strength: m.strength, dosage_form: m.dosage_form, manufacturer: m.manufacturer };
    });
    productIds = products.map((p) => p.id);
    for (let i = 0; i < products.length; i += 500) {
      const chunk = await admin.from("products").insert(products.slice(i, i + 500));
      if (chunk.error) throw new Error(`seed products: ${chunk.error.message}`);
    }
    // PostgreSQL keeps table statistics that the planner uses to choose between an index and a full scan. A table that was
    // just filled with 5,000 rows still has the statistics of an almost empty table until the automatic refresh (the
    // autovacuum analyze, about a minute) has run, and measuring before that would time a plan no real, settled catalog uses.
    await new Promise((resolve) => setTimeout(resolve, STATS_WAIT_MS));
  }, 600_000);

  afterAll(async () => {
    const max = (values: number[]) => (values.length ? Math.max(...values) : 0);
    const summary =
      `voice scale (${MEDICINES} medicines, ${STORES} stores, ${ITEMS} items, ${RUNS} runs): ` +
        `preview first call ${firstMs} ms, then max ${max(previewMs)} ms [${previewMs.join(", ")}], database matching max ${max(matchMs)} ms [${matchMs.join(", ")}], ` +
        `create 200-line draft max ${max(createMs)} ms [${createMs.join(", ")}]`;
    console.log(summary);
    // vitest hides the output of a passing run, so the numbers are also written where the next step can read them
    writeFileSync(path.join(tmpdir(), "voice-scale-last-run.txt"), `${summary}
`);
    if (a) await deleteTenant(a);
  }, 600_000);

  it(`builds the preview of a ${ITEMS}-item answer within ${GOAL_MS} ms (parse, limit check, matching, store, log)`, async () => {
    const names = spokenNames();
    // The very first call after a long idle time also loads caches on the database side, so it is timed and reported
    // separately (and held to a looser bound); the five runs after it are held to the goal.
    for (let run = -1; run < RUNS; run += 1) {
      const parser = new FakeParser(rawParse(storeName(50), names.map((name) => rawItem(name, 2, "strips"))));
      const started = performance.now();
      const preview = await parseTranscript(a.client, { transcript: "scale test", parser: "ai" }, { parserFor: () => parser });
      const ms = Math.round(performance.now() - started);
      if (run === -1) firstMs = ms;
      else previewMs.push(ms);
      expect(preview.lines).toHaveLength(ITEMS);
      // the exact names are matched; the near spellings are offered as choices and never decided for the supplier
      expect(preview.lines.filter((l) => l.state === "matched")).toHaveLength(ITEMS - ITEMS / 4);
      expect(preview.lines.filter((l) => l.state === "choose_one").length).toBeGreaterThan(0);
      expect(preview.store.state).toBe("matched");
      expect(ms, run === -1 ? "first call" : `run ${run + 1}`).toBeLessThan(run === -1 ? 3 * GOAL_MS : GOAL_MS);
    }
  }, 120_000);

  it(`matches ${ITEMS} spoken names and a store in the database within ${GOAL_MS} ms`, async () => {
    const names = spokenNames();
    for (let run = 0; run < RUNS; run += 1) {
      const started = performance.now();
      const [products, stores] = await Promise.all([matchProducts(a.client, names), matchStores(a.client, storeName(7))]);
      const ms = Math.round(performance.now() - started);
      matchMs.push(ms);
      expect(new Set(products.map((p) => p.idx)).size).toBeGreaterThan(ITEMS * 0.75);
      expect(stores.some((s) => s.is_exact)).toBe(true);
      expect(ms, `run ${run + 1}`).toBeLessThan(GOAL_MS);
    }
  }, 120_000);

  it(`creates a ${ITEMS}-line voice draft within ${GOAL_MS} ms`, async () => {
    const storeRow = await serviceClient().from("stores").select("id").eq("business_id", a.businessId as string).eq("name", storeName(3)).single();
    expect(storeRow.error).toBeNull();
    for (let run = 0; run < RUNS; run += 1) {
      const lines = Array.from({ length: ITEMS }, (_, i) => catalogLine(productIds[(run * ITEMS + i) % productIds.length], 1 + (i % 9), "strip"));
      const body = OrderSaveSchema.parse({ ...savePayload(storeRow.data!.id as string, lines), source: "voice", spoken_text: "scale test" });
      const started = performance.now();
      const saved = await saveOrder(a.client, randomUUID(), body);
      const ms = Math.round(performance.now() - started);
      createMs.push(ms);
      expect(saved.result.order.lines).toHaveLength(ITEMS);
      expect(ms, `run ${run + 1}`).toBeLessThan(GOAL_MS);
    }
  }, 120_000);
});
