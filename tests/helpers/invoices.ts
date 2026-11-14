import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allKeys } from "./market-db";
import { seedMedicineWithClient, seedOrderWithClient, seedStoreWithClient, type SeededOrder } from "./pending";

// Shared pieces of the invoice tests (PGlite, Supabase integration and the browser tests).

/** Key names that must never appear in any invoice, order sheet or print data (Principle II). */
export const FORBIDDEN_KEY = /purchase|mrp|cost|margin|profit/i;

/** Every key of a JSON value (any depth) whose name suggests a purchase price, MRP, cost, margin or profit. */
export function scanForbiddenKeys(value: unknown): string[] {
  return [...allKeys(value)].filter((key) => FORBIDDEN_KEY.test(key));
}

/** The words that must never appear in a printed invoice or order sheet (text check). */
export const FORBIDDEN_WORDS = /purchase|\bmrp\b|\bcost\b|margin|profit/i;

/** A decimal string with two decimals from a number of paisa-exact parts, for expected totals in tests. */
export function money(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/** Argument objects for the Supabase `rpc` calls of the invoice functions. */
export const invoiceArgs = {
  create: (id: string, orderId: string) => ({ p_id: id, p_order_id: orderId }),
  setQuantities: (id: string, version: number, lines: Array<{ line_id: string; delivered_quantity: number }>) => ({
    p_id: id,
    p_expected_version: version,
    p_lines: lines,
  }),
  refresh: (id: string, version: number) => ({ p_id: id, p_expected_version: version }),
  discard: (id: string, version: number) => ({ p_id: id, p_expected_version: version }),
  issue: (id: string, version: number) => ({ p_id: id, p_expected_version: version }),
  cancel: (id: string, reason: string | null) => ({ p_id: id, p_reason: reason }),
};

// ---------------------------------------------------------------------------------------------------
// Seeding on a Supabase test project with a signed-in client (the real order functions run, so every row is legitimate)
// ---------------------------------------------------------------------------------------------------

export interface ClientCatalog {
  storeId: string;
  /** Panadol: selling 125.50, with a purchase price of 90.00 and an MRP of 130.00 on the medicine. */
  pricedId: string;
  /** Brufen: selling 310.00, purchase 200.00, MRP 350.00. */
  sellingOnlyId: string;
  /** No price at all. */
  noPriceId: string;
  names: { priced: string; sellingOnly: string; noPrice: string };
}

/** One store and three medicines for a signed-in client, with unique names so one business can have many catalogs. */
export async function seedCatalogWithClient(client: SupabaseClient, storeName?: string): Promise<ClientCatalog> {
  const suffix = randomUUID().slice(0, 6);
  const names = { priced: `Panadol 500mg ${suffix}`, sellingOnly: `Brufen 400mg ${suffix}`, noPrice: `Calpol Syrup ${suffix}` };
  const storeId = await seedStoreWithClient(client, storeName ?? `Store ${suffix}`);
  const pricedId = await seedMedicineWithClient(client, { name: names.priced, unit: "strip", strength: "500 mg", dosage_form: "tablet", purchase_price: "90.00", selling_price: "125.50", mrp: "130.00" });
  const sellingOnlyId = await seedMedicineWithClient(client, { name: names.sellingOnly, unit: "box", strength: "400 mg", dosage_form: "tablet", purchase_price: "200.00", selling_price: "310.00", mrp: "350.00" });
  const noPriceId = await seedMedicineWithClient(client, { name: names.noPrice, unit: "bottle", dosage_form: "syrup" });
  return { storeId, pricedId, sellingOnlyId, noPriceId, names };
}

/** A confirmed order of the catalog's store. By default 10 x Panadol and 5 x Brufen (total 2805.00). */
export async function seedConfirmedOrderOn(
  client: SupabaseClient,
  catalog: ClientCatalog,
  lines?: Array<{ product_id: string | null; name?: string; quantity?: number; unit?: string }>,
): Promise<SeededOrder> {
  return seedOrderWithClient(
    client,
    catalog.storeId,
    lines ?? [
      { product_id: catalog.pricedId, quantity: 10, unit: "strip" },
      { product_id: catalog.sellingOnlyId, quantity: 5, unit: "box" },
    ],
    { confirm: true },
  );
}
