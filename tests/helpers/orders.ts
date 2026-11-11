import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

// Builders shared by the order tests (PGlite, Supabase integration and the browser tests).

export interface LineInput {
  id: string;
  product_id: string | null;
  name: string | null;
  quantity: number;
  unit: string;
}

export interface SavePayload {
  request_id: string;
  expected_version: number | null;
  store_id: string;
  notes: string | null;
  lines: LineInput[];
}

/** A catalog line: the server copies the medicine's description, so no name is sent. */
export function catalogLine(productId: string, quantity = 1, unit = "strip", overrides: Partial<LineInput> = {}): LineInput {
  return { id: randomUUID(), product_id: productId, name: null, quantity, unit, ...overrides };
}

/** A typed (not registered) line: keeps the exact typed name. */
export function typedLine(name: string, quantity = 1, unit = "strip", overrides: Partial<LineInput> = {}): LineInput {
  return { id: randomUUID(), product_id: null, name, quantity, unit, ...overrides };
}

/** The body of a first save (creation). Every call gets a fresh request id. */
export function savePayload(storeId: string, lines: LineInput[], overrides: Partial<SavePayload> = {}): SavePayload {
  return { request_id: randomUUID(), expected_version: null, store_id: storeId, notes: null, lines, ...overrides };
}

/** The same payload as the arguments of the database function `order_save`. */
export function saveArgs(orderId: string, payload: SavePayload) {
  return {
    p_id: orderId,
    p_request_id: payload.request_id,
    p_expected_version: payload.expected_version,
    p_store_id: payload.store_id,
    p_notes: payload.notes,
    p_lines: payload.lines,
  };
}

export interface Seeded {
  storeId: string;
  /** Has all three prices: purchase 90.00, selling 125.50, MRP 130.00. */
  pricedId: string;
  /** Has only a selling price: 310.00. */
  sellingOnlyId: string;
  /** Has no price at all. */
  noPriceId: string;
}

const PRODUCTS = (ids: { priced: string; sellingOnly: string; noPrice: string }) => [
  { id: ids.priced, name: "Panadol 500mg", unit: "strip", strength: "500 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK", purchase_price: "90.00", selling_price: "125.50", mrp: "130.00" },
  { id: ids.sellingOnly, name: "Brufen 400mg", unit: "box", strength: "400 mg", dosage_form: "tablet", selling_price: "310.00" },
  { id: ids.noPrice, name: "Calpol Syrup", unit: "bottle", dosage_form: "syrup" },
];

/** Seeds one store and three medicines through a signed-in client (so RLS applies). */
export async function seedWithClient(client: SupabaseClient, storeName = "Al Shifa Pharmacy"): Promise<Seeded> {
  const seeded: Seeded = { storeId: randomUUID(), pricedId: randomUUID(), sellingOnlyId: randomUUID(), noPriceId: randomUUID() };
  const store = await client.from("stores").insert({ id: seeded.storeId, name: storeName });
  if (store.error) throw new Error(`seed store: ${store.error.message}`);
  const products = await client
    .from("products")
    .insert(PRODUCTS({ priced: seeded.pricedId, sellingOnly: seeded.sellingOnlyId, noPrice: seeded.noPriceId }));
  if (products.error) throw new Error(`seed products: ${products.error.message}`);
  return seeded;
}

/** Seeds one store and three medicines directly in a PGlite database for the given business. */
export async function seedWithDb(db: PGlite, businessId: string, storeName = "Al Shifa Pharmacy"): Promise<Seeded> {
  const seeded: Seeded = { storeId: randomUUID(), pricedId: randomUUID(), sellingOnlyId: randomUUID(), noPriceId: randomUUID() };
  await db.query(`insert into public.stores (id, business_id, name) values ($1, $2, $3)`, [seeded.storeId, businessId, storeName]);
  for (const p of PRODUCTS({ priced: seeded.pricedId, sellingOnly: seeded.sellingOnlyId, noPrice: seeded.noPriceId })) {
    await db.query(
      `insert into public.products (id, business_id, name, unit, strength, dosage_form, pack_size, manufacturer, purchase_price, selling_price, mrp)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        p.id, businessId, p.name, p.unit,
        "strength" in p ? p.strength : null, p.dosage_form,
        "pack_size" in p ? p.pack_size : null, "manufacturer" in p ? p.manufacturer : null,
        "purchase_price" in p ? p.purchase_price : null, "selling_price" in p ? p.selling_price : null, "mrp" in p ? p.mrp : null,
      ],
    );
  }
  return seeded;
}
