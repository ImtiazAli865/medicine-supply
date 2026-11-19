import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { scanForbiddenKeys } from "./invoices";
import { seedOrderWithClient, seedStoreWithClient, type SeededOrder } from "./pending";
import { createTenant, serviceClient, type TestTenant } from "./supabase-test";

// Shared pieces of the Module 008 tests (integration on the Supabase test project and the browser tests).
// Orders are always created through the real order functions (as the tenant's own signed-in user), so every row is legitimate.

export { scanForbiddenKeys, seedOrderWithClient, seedStoreWithClient };
export type { SeededOrder };

/** Words that must not appear anywhere in a response or in new source code of this module. */
export const NO_PRICE_WORDS = /purchase|\bmrp\b|\bcost\b|margin|profit|balance|snapshot|invoice/i;

/** Two real businesses (each with an owner signed in), for the isolation tests. */
export async function bothTenants(): Promise<{ a: TestTenant; b: TestTenant }> {
  const [a, b] = await Promise.all([createTenant("fast-a"), createTenant("fast-b")]);
  return { a, b };
}

export interface SeedMedicine {
  name: string;
  unit?: string;
  strength?: string | null;
  dosage_form?: string | null;
  pack_size?: string | null;
  manufacturer?: string | null;
  selling_price?: string | null;
  /** Purchase price and MRP are set on purpose so a leak into a response would be caught. */
  purchase_price?: string | null;
  mrp?: string | null;
  is_active?: boolean;
}

/** Inserts the medicines in blocks of 500 and returns their ids in the same order. */
export async function insertMedicines(client: SupabaseClient, medicines: SeedMedicine[]): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < medicines.length; i += 500) {
    const block = medicines.slice(i, i + 500).map((m) => ({
      id: randomUUID(),
      name: m.name,
      unit: m.unit ?? "strip",
      strength: m.strength ?? null,
      dosage_form: m.dosage_form ?? null,
      pack_size: m.pack_size ?? null,
      manufacturer: m.manufacturer ?? null,
      selling_price: m.selling_price ?? "50.00",
      purchase_price: m.purchase_price ?? "31.00",
      mrp: m.mrp ?? "60.00",
      is_active: m.is_active ?? true,
    }));
    const res = await client.from("products").insert(block);
    if (res.error) throw new Error(`seed medicines: ${res.error.message}`);
    ids.push(...block.map((b) => b.id));
  }
  return ids;
}

/** `count` active medicines with unique, predictable names ("Medicine 00001"), strengths and forms. */
export async function seedCatalog(client: SupabaseClient, count: number, prefix = "Medicine"): Promise<string[]> {
  const forms = ["tablet", "capsule", "syrup", "injection"];
  return insertMedicines(
    client,
    Array.from({ length: count }, (_, i) => ({
      name: `${prefix} ${String(i + 1).padStart(5, "0")}`,
      strength: `${(i % 9) * 50 + 50} mg`,
      dosage_form: forms[i % forms.length],
      pack_size: String((i % 5) * 10 + 10),
      manufacturer: `Maker ${(i % 7) + 1}`,
    })),
  );
}

/** One brand in several strengths, forms and pack sizes: they must never be merged or substituted. */
export async function seedSimilar(client: SupabaseClient): Promise<Record<string, string>> {
  const defs: Array<[string, SeedMedicine]> = [
    ["p250", { name: "Panadol", strength: "250 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK" }],
    ["p500", { name: "Panadol", strength: "500 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK" }],
    ["p500s", { name: "Panadol", strength: "500 mg", dosage_form: "syrup", pack_size: "60 ml", manufacturer: "GSK" }],
    ["p500x", { name: "Panadol", strength: "500 mg", dosage_form: "tablet", pack_size: "20", manufacturer: "Other Maker" }],
  ];
  const ids = await insertMedicines(client, defs.map(([, m]) => m));
  return Object.fromEntries(defs.map(([key], i) => [key, ids[i]!]));
}

/** Moves the confirmation time of an order (the service role only, inside a test: signed-in users cannot update orders). */
export async function setConfirmedAt(orderId: string, iso: string): Promise<void> {
  const res = await serviceClient().from("orders").update({ confirmed_at: iso }).eq("id", orderId);
  if (res.error) throw new Error(`set confirmed_at: ${res.error.message}`);
}

export interface HistoryLine {
  product_id: string | null;
  name?: string;
  quantity?: number;
  unit?: string;
}

/** A confirmed order for the store, optionally dated in the past. */
export async function seedConfirmedOrder(
  client: SupabaseClient,
  storeId: string,
  lines: HistoryLine[],
  options: { confirmedAt?: string } = {},
): Promise<SeededOrder> {
  const order = await seedOrderWithClient(client, storeId, lines, { confirm: true });
  if (options.confirmedAt) await setConfirmedAt(order.orderId, options.confirmedAt);
  return order;
}

/** `orders` confirmed orders of `linesPerOrder` lines each, cycling over the given medicines (for the scale tests). */
export async function seedHistory(
  client: SupabaseClient,
  storeId: string,
  productIds: string[],
  options: { orders: number; linesPerOrder: number },
): Promise<void> {
  for (let start = 0; start < options.orders; start += 10) {
    await Promise.all(
      Array.from({ length: Math.min(10, options.orders - start) }, (_, k) => {
        const n = start + k;
        const lines = Array.from({ length: options.linesPerOrder }, (_, j) => ({
          product_id: productIds[(n * 7 + j) % productIds.length]!,
          quantity: ((n + j) % 20) + 1,
          unit: "strip",
        }));
        return seedOrderWithClient(client, storeId, lines, { confirm: true });
      }),
    );
  }
}

/** Keys and words in a response that suggest a price, cost, balance or invoice value (an empty list means clean). */
export function priceLeaks(value: unknown): string[] {
  const leaks = scanForbiddenKeys(value).map((key) => `key:${key}`);
  const word = JSON.stringify(value).match(NO_PRICE_WORDS);
  if (word) leaks.push(`word:${word[0]}`);
  return leaks;
}
