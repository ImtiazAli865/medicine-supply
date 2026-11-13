import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Builders shared by the Module 004 tests (PGlite, Supabase integration and the browser tests).

export interface RegisterProductInput {
  id: string;
  name: string;
  unit: string;
  brand?: string | null;
  generic_name?: string | null;
  strength?: string | null;
  dosage_form?: string | null;
  manufacturer?: string | null;
  pack_size?: string | null;
  sku?: string | null;
  purchase_price?: string | null;
  selling_price?: string | null;
  mrp?: string | null;
}

export interface RegisterBody {
  request_id: string;
  expected_version: number;
  product: RegisterProductInput;
  confirm_similar: boolean;
  apply_price: boolean;
}

/** A register request with only a name and a unit unless the test adds more. Every call gets fresh ids. */
export function registerBody(expectedVersion: number, product: Partial<RegisterProductInput> = {}, overrides: Partial<Omit<RegisterBody, "product" | "expected_version">> = {}): RegisterBody {
  return {
    request_id: randomUUID(),
    expected_version: expectedVersion,
    product: { id: randomUUID(), name: "Noran 20mg cap", unit: "strip", ...product },
    confirm_similar: false,
    apply_price: false,
    ...overrides,
  };
}

export interface LinkBody {
  request_id: string;
  expected_version: number;
  product_id: string;
  how: "existing" | "proposal";
  apply_price: boolean;
}

export function linkBody(expectedVersion: number, productId: string, overrides: Partial<Omit<LinkBody, "expected_version" | "product_id">> = {}): LinkBody {
  return { request_id: randomUUID(), expected_version: expectedVersion, product_id: productId, how: "existing", apply_price: false, ...overrides };
}

export interface PriceBody {
  request_id: string;
  price: string;
  line_ids: string[];
  fill_lines: boolean;
}

export function priceBody(price: string, lineIds: string[], overrides: Partial<PriceBody> = {}): PriceBody {
  return { request_id: randomUUID(), price, line_ids: lineIds, fill_lines: true, ...overrides };
}

/** The arguments of the database function `pending_line_register`. */
export function registerArgs(orderId: string, lineId: string, body: RegisterBody) {
  return {
    p_order: orderId,
    p_line: lineId,
    p_request_id: body.request_id,
    p_expected_version: body.expected_version,
    p_product: body.product,
    p_confirm_similar: body.confirm_similar,
    p_apply_price: body.apply_price,
  };
}

/** The arguments of the database function `pending_line_link`. */
export function linkArgs(orderId: string, lineId: string, body: LinkBody) {
  return {
    p_order: orderId,
    p_line: lineId,
    p_request_id: body.request_id,
    p_expected_version: body.expected_version,
    p_product_id: body.product_id,
    p_apply_price: body.apply_price,
    p_how: body.how,
  };
}

/** The arguments of the database function `pending_price_apply`. */
export function priceArgs(productId: string, body: PriceBody) {
  return { p_product: productId, p_price: body.price, p_request_id: body.request_id, p_line_ids: body.line_ids, p_fill_lines: body.fill_lines };
}

// ---------------------------------------------------------------------------------------------------
// Seeding through a signed-in Supabase client (the real order functions, so every row is legitimate)
// ---------------------------------------------------------------------------------------------------

export interface SeededOrder {
  orderId: string;
  version: number;
  number: number;
  lineIds: string[];
}

interface OrderLike {
  id: string;
  version: number;
  order_number: number;
  lines: Array<{ id: string }>;
}

export async function seedStoreWithClient(client: SupabaseClient, name = "Al Shifa Pharmacy"): Promise<string> {
  const id = randomUUID();
  const res = await client.from("stores").insert({ id, name });
  if (res.error) throw new Error(`seed store: ${res.error.message}`);
  return id;
}

export async function seedMedicineWithClient(client: SupabaseClient, fields: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  const res = await client.from("products").insert({ id, name: "Panadol 500mg", unit: "strip", ...fields });
  if (res.error) throw new Error(`seed medicine: ${res.error.message}`);
  return id;
}

/** Creates an order through `order_save` (and confirms it when asked). Lines are typed or catalog lines. */
export async function seedOrderWithClient(
  client: SupabaseClient,
  storeId: string,
  lines: Array<{ product_id: string | null; name?: string; quantity?: number; unit?: string }>,
  options: { confirm?: boolean } = {},
): Promise<SeededOrder> {
  const orderId = randomUUID();
  const saved = await client.rpc("order_save", {
    p_id: orderId,
    p_request_id: randomUUID(),
    p_expected_version: null,
    p_store_id: storeId,
    p_notes: null,
    p_lines: lines.map((l) => ({ id: randomUUID(), product_id: l.product_id, name: l.name ?? null, quantity: l.quantity ?? 1, unit: l.unit ?? "strip" })),
  });
  if (saved.error || !saved.data?.saved) throw new Error(`seed order: ${saved.error?.message ?? JSON.stringify(saved.data)}`);
  let order = saved.data.order as OrderLike;
  if (options.confirm) {
    const confirmed = await client.rpc("order_confirm", { p_id: orderId, p_request_id: randomUUID(), p_expected_version: order.version });
    if (confirmed.error || !confirmed.data?.confirmed) throw new Error(`seed confirm: ${confirmed.error?.message ?? JSON.stringify(confirmed.data)}`);
    order = confirmed.data.order as OrderLike;
  }
  return { orderId, version: order.version, number: order.order_number, lineIds: order.lines.map((l) => l.id) };
}

export async function getOrderWithClient(client: SupabaseClient, orderId: string) {
  const res = await client.rpc("order_get", { p_id: orderId });
  if (res.error) throw new Error(`order_get: ${res.error.message}`);
  return res.data as OrderLike & { status: string; lines: Array<Record<string, unknown>>; events: Array<Record<string, unknown>> };
}
