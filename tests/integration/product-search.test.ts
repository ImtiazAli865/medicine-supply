import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listProducts } from "@/lib/products/repository";
import { ListQuerySchema } from "@/lib/validation/store";
import { createTenant, deleteTenant, hasTestEnv, serviceClient, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// SC-002: search stays under one second for 5,000 products and 500 stores. Seeds a throwaway
// business in the TEST project through the service role, then queries as the real user.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const BRANDS = ["Panadol", "Brufen", "Augmentin", "Calpol", "Disprin", "Flagyl", "Zantac", "Ventolin"];
const FORMS = ["Tablet", "Syrup", "Capsule", "Injection", "Cream"];

suite("search performance at scale (SC-002)", () => {
  let a: TestTenant;

  beforeAll(async () => {
    a = await createTenant("perf-a");
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

    const stores = Array.from({ length: 500 }, (_, i) => ({
      id: randomUUID(),
      business_id: a.businessId,
      name: `Store ${i} ${BRANDS[i % BRANDS.length]} Medical`,
      contact_person: `Person ${i}`,
      phone: `0300${String(1000000 + i)}`,
    }));
    const { error } = await admin.from("stores").insert(stores);
    if (error) throw new Error(`seed stores failed: ${error.message}`);
  }, 180_000);

  afterAll(async () => {
    await deleteTenant(a);
  }, 120_000);

  it("returns product search results in under 1 second for 5,000 products", async () => {
    // Search covers name, brand, generic name, strength, manufacturer, SKU and dosage form (Module 003 order
    // screen needs the dosage form; the same measurement stands for the 1-second goal of that screen, SC-009).
    for (const q of ["PAN", "brufen 4", "sku-4999", "Maker 17", "250 mg", "tablet", "syrup 250", "panadol capsule"]) {
      const started = performance.now();
      const page = await listProducts(a.client, ListQuerySchema.parse({ q }));
      const elapsed = performance.now() - started;
      expect(page.items.length, `results for ${q}`).toBeGreaterThan(0);
      expect(elapsed, `search "${q}" took ${Math.round(elapsed)} ms`).toBeLessThan(1000);
    }
  });

  it("matches a dosage form word, and every word must match something", async () => {
    const tablets = await listProducts(a.client, ListQuerySchema.parse({ q: "tablet", limit: "100" }));
    expect(tablets.items.length).toBeGreaterThan(0);
    expect(tablets.items.every((p) => p.dosage_form === "Tablet")).toBe(true);
    const both = await listProducts(a.client, ListQuerySchema.parse({ q: "panadol tablet", limit: "100" }));
    expect(both.items.length).toBeGreaterThan(0);
    expect(both.items.every((p) => p.dosage_form === "Tablet" && p.name.startsWith("Panadol"))).toBe(true);
    const none = await listProducts(a.client, ListQuerySchema.parse({ q: "panadol injection xyznotaword" }));
    expect(none.items).toEqual([]);
  });

  it("treats commas, brackets, quotes, backslashes and wildcards in the search text as plain text, never as filter syntax", async () => {
    for (const q of ["5,mg", "a)b", "(x", 'x"y', "back\slash", "50%", "a_b", "name.eq.x", "x),(y", "tablet,syrup", "'; drop"]) {
      const page = await listProducts(a.client, ListQuerySchema.parse({ q }));
      expect(Array.isArray(page.items), `search "${q}"`).toBe(true);
    }
    // a comma inside one word must not split into two filters: this finds nothing instead of everything
    const comma = await listProducts(a.client, ListQuerySchema.parse({ q: "tablet,syrup" }));
    expect(comma.items).toEqual([]);
  });

  it("pages through all matches without repeats", async () => {
    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listProducts(a.client, ListQuerySchema.parse({ q: "panadol", limit: "100", cursor }));
      for (const p of page.items) seen.add(p.id);
      cursor = page.next_cursor ?? undefined;
      pages++;
    } while (cursor && pages < 20);
    expect(seen.size).toBe(625); // 5000 products / 8 brands
  });
});
