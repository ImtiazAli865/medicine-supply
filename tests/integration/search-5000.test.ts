import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listProducts } from "@/lib/products/repository";
import { ListQuerySchema } from "@/lib/validation/store";
import { createTenant, deleteTenant, hasTestEnv, serviceClient, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// SC-009: with 5,000 medicines, at least 95% of 40 searches (name, strength, manufacturer, SKU,
// dosage form and two-word searches) return within 1 second. Seeds a throwaway business in the
// TEST project through the service role, then searches as the real signed-in user, with no warm-up
// query, so the first (coldest) search is counted too.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const BRANDS = ["Panadol", "Brufen", "Augmentin", "Calpol", "Disprin", "Flagyl", "Zantac", "Ventolin"];
const FORMS = ["Tablet", "Syrup", "Capsule", "Injection", "Cream"];

const SEARCHES: { kind: string; q: string }[] = [
  // name (8)
  ...["Panadol", "brufen", "AUGMENTIN", "calpol 12", "dis", "flagyl 3", "zantac 4006", "vent"].map((q) => ({ kind: "name", q })),
  // strength (6)
  ...["25 mg", "250 mg", "500 mg", "75 mg", "125 mg", "400 mg"].map((q) => ({ kind: "strength", q })),
  // manufacturer (6)
  ...["Maker 17", "maker 3", "Maker 39", "Maker 0", "maker 25", "Maker 8"].map((q) => ({ kind: "manufacturer", q })),
  // SKU (6)
  ...["SKU-4999", "sku-0", "SKU-2500", "sku-123", "SKU-777", "SKU-4000"].map((q) => ({ kind: "sku", q })),
  // dosage form (6)
  ...["tablet", "syrup", "Capsule", "injection", "cream", "tab"].map((q) => ({ kind: "dosage form", q })),
  // two words (8)
  ...["panadol tablet", "brufen 400 mg", "syrup 250", "augmentin capsule", "calpol maker 3", "flagyl injection", "zantac cream", "ventolin 75 mg"].map(
    (q) => ({ kind: "two words", q }),
  ),
];

suite("medicine search at 5,000 medicines (SC-009)", () => {
  let a: TestTenant;

  beforeAll(async () => {
    a = await createTenant("search-5000");
    const admin = serviceClient();
    const products = Array.from({ length: 5000 }, (_, i) => ({
      id: randomUUID(),
      business_id: a.businessId,
      name: `${BRANDS[i % BRANDS.length]} ${i}`,
      unit: "strip",
      brand: BRANDS[i % BRANDS.length],
      strength: `${(i % 20) * 25 + 25} mg`,
      dosage_form: FORMS[i % FORMS.length],
      manufacturer: `Maker ${i % 40}`,
      sku: `SKU-${i}`,
    }));
    for (let i = 0; i < products.length; i += 500) {
      const { error } = await admin.from("products").insert(products.slice(i, i + 500));
      if (error) throw new Error(`seed products failed: ${error.message}`);
    }
  }, 180_000);

  afterAll(async () => {
    await deleteTenant(a);
  }, 120_000);

  it("has exactly 40 searches in the plan", () => {
    expect(SEARCHES).toHaveLength(40);
  });

  it("answers at least 95% of 40 searches within 1 second, and every search finds something", async () => {
    const timings: { kind: string; q: string; ms: number }[] = [];
    for (const { kind, q } of SEARCHES) {
      const started = performance.now();
      const page = await listProducts(a.client, ListQuerySchema.parse({ q, limit: "30" }));
      const ms = performance.now() - started;
      timings.push({ kind, q, ms });
      expect(page.items.length, `results for "${q}" (${kind})`).toBeGreaterThan(0);
    }
    const sorted = timings.map((t) => t.ms).sort((x, y) => x - y);
    const within = timings.filter((t) => t.ms < 1000).length;
    const median = Math.round(sorted[Math.floor(sorted.length / 2)]);
    const p95 = Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]);
    const max = Math.round(sorted[sorted.length - 1]);
    const slowest = [...timings].sort((x, y) => y.ms - x.ms)[0];
    console.log(
      `search at 5,000 medicines: ${within}/40 within 1 s; median ${median} ms, p95 ${p95} ms, max ${max} ms ("${slowest.q}", ${slowest.kind})`,
    );
    expect(within / timings.length, `only ${within} of 40 searches were under 1 second`).toBeGreaterThanOrEqual(0.95);
  }, 120_000);
});
