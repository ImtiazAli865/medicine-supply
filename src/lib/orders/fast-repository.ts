import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "@/lib/api/errors";
import { decodeCursor, slicePage } from "@/lib/api/paging";
import { canonicalMoney } from "@/lib/money";
import { escapeLike, searchTokens } from "@/lib/normalize";
import { quoteFilterValue } from "@/lib/products/repository";
import {
  SLIM_MEDICINE_KEYS,
  USUAL_MAX,
  USUAL_MAX_ORDERS,
  USUAL_WINDOW_DAYS,
  type MedicinePage,
  type RepeatPlan,
  type RepeatSource,
  type SlimMedicine,
  type UsualResponse,
} from "./fast-types";
import { pickUsual, planRepeat, rankUsual, type ProductLookup, type QualifyingOrder, type RepeatSourceLine, type UsualLine } from "./fast-usual";

// Server reads for Module 008. Every call runs as the signed-in user, so Row Level Security limits it to
// their business. Columns are always listed explicitly: no purchase price, MRP, cost or snapshot is ever selected.
//
// Speed: from a developer PC or a phone-facing server the cost is dominated by the number of sequential requests to the
// database (about 250 ms each on the test project), so each read is written as few requests as possible: the lines of an
// order are embedded in the order request (the 1,000-row cap of PostgREST applies to the top-level rows only), and
// independent requests run in parallel.

const LOOKUP_CHUNK = 50;
const QUALIFYING = ["confirmed", "fulfilled"] as const;

/** The slim column list, with the one money column read as text so the decimal stays exact. */
export const SLIM_COLUMNS = SLIM_MEDICINE_KEYS.map((key) => (key === "selling_price" ? "selling_price::text" : key)).join(",");

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function toSlim(row: Row): SlimMedicine {
  const price = row.selling_price == null ? null : canonicalMoney(String(row.selling_price));
  return {
    id: row.id as string,
    name: row.name as string,
    unit: row.unit as string,
    brand: text(row.brand),
    generic_name: text(row.generic_name),
    strength: text(row.strength),
    dosage_form: text(row.dosage_form),
    manufacturer: text(row.manufacturer),
    pack_size: text(row.pack_size),
    sku: text(row.sku),
    selling_price: price,
  };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The latest confirmed or fulfilled order of the store (any age) and how many lines it has, in one request. null when there is none. */
export async function getRepeatSource(supabase: SupabaseClient, storeId: string): Promise<RepeatSource | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("id,order_number,confirmed_at,order_lines(count)")
    .eq("store_id", storeId)
    .in("status", [...QUALIFYING])
    .not("confirmed_at", "is", null)
    .is("order_lines.removed_at", null)
    .order("confirmed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error) throw error;
  const order = (data ?? [])[0] as (Row & { order_lines?: Array<{ count: number }> }) | undefined;
  if (!order) return null;
  return {
    order_id: order.id as string,
    order_number: order.order_number as number,
    confirmed_at: order.confirmed_at as string,
    line_count: order.order_lines?.[0]?.count ?? 0,
  };
}

/** The store's recent qualifying orders with their catalog lines, in one request (the lines are embedded). */
async function recentOrdersWithLines(supabase: SupabaseClient, storeId: string): Promise<{ orders: QualifyingOrder[]; lines: UsualLine[] }> {
  const since = new Date(Date.now() - USUAL_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("orders")
    .select("id,confirmed_at,order_lines(product_id,quantity,unit,position)")
    .eq("store_id", storeId)
    .in("status", [...QUALIFYING])
    .gte("confirmed_at", since)
    .is("order_lines.removed_at", null)
    .not("order_lines.product_id", "is", null)
    .order("confirmed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(USUAL_MAX_ORDERS);
  if (error) throw error;
  const orders: QualifyingOrder[] = [];
  const lines: UsualLine[] = [];
  for (const row of (data ?? []) as Array<Row & { order_lines?: Row[] }>) {
    orders.push({ id: row.id as string, confirmed_at: row.confirmed_at as string });
    for (const l of row.order_lines ?? []) {
      lines.push({ order_id: row.id as string, product_id: l.product_id as string, quantity: l.quantity as number, unit: l.unit as string, position: l.position as number });
    }
  }
  return { orders, lines };
}

/** Looks up active medicines by id (slim columns). Missing and inactive ids are simply absent. */
async function lookupActive(supabase: SupabaseClient, ids: string[]): Promise<Map<string, SlimMedicine>> {
  const found = new Map<string, SlimMedicine>();
  const blocks = await Promise.all(
    chunks(ids, LOOKUP_CHUNK).map((chunk) => supabase.from("products").select(SLIM_COLUMNS).in("id", chunk).eq("is_active", true)),
  );
  for (const { data, error } of blocks) {
    if (error) throw error;
    for (const row of (data ?? []) as unknown as Row[]) found.set(row.id as string, toSlim(row));
  }
  return found;
}

/** The store's usual medicines (up to 12, active only) and its repeat source. */
export async function listUsual(supabase: SupabaseClient, storeId: string): Promise<UsualResponse> {
  const [source, recent] = await Promise.all([getRepeatSource(supabase, storeId), recentOrdersWithLines(supabase, storeId)]);
  if (!source || recent.orders.length === 0) return { usual: [], source };

  const ranked = rankUsual(recent.orders, recent.lines);
  // Look the best candidates up in blocks; inactive ones fall out, so keep going until 12 active ones are found.
  const active = new Map<string, SlimMedicine>();
  const FIRST_BLOCK = LOOKUP_CHUNK * 2; // two requests at once cover the usual case
  const blocks = [ranked.slice(0, FIRST_BLOCK), ...chunks(ranked.slice(FIRST_BLOCK), LOOKUP_CHUNK * 4)];
  for (const block of blocks) {
    if (block.length === 0) break;
    for (const [id, medicine] of await lookupActive(supabase, block.map((r) => r.product_id))) active.set(id, medicine);
    if (pickUsual(ranked, active).length >= USUAL_MAX) break;
  }
  return { usual: pickUsual(ranked, active), source };
}

/**
 * The lines to copy from one of the store's qualifying orders, and what had to be left out, in one request (the lines and
 * their medicines are embedded). The answer for an order that does not exist for this business, is of another store, or is
 * not confirmed or fulfilled is always "not found".
 */
export async function getRepeatPlan(supabase: SupabaseClient, storeId: string, orderId: string): Promise<RepeatPlan> {
  const { data, error } = await supabase
    .from("orders")
    .select(`id,order_lines(product_id,name,quantity,unit,position,products!order_lines_product_fk(${SLIM_COLUMNS},is_active))`)
    .eq("id", orderId)
    .eq("store_id", storeId)
    .in("status", [...QUALIFYING])
    .is("order_lines.removed_at", null)
    .order("position", { referencedTable: "order_lines", ascending: true })
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound();

  const lines: RepeatSourceLine[] = [];
  const lookup: ProductLookup = new Map();
  for (const l of ((data as unknown as { order_lines?: Row[] }).order_lines ?? []) as Row[]) {
    const productId = (l.product_id as string | null) ?? null;
    lines.push({ position: l.position as number, product_id: productId, name: l.name as string, quantity: l.quantity as number, unit: l.unit as string });
    const product = l.products as Row | null | undefined;
    if (productId && product) lookup.set(productId, { medicine: toSlim(product), active: product.is_active === true });
  }
  return planRepeat(lines, lookup);
}

/** One page of the active catalog in slim shape, ordered by name then id. */
export async function listMedicinesPage(supabase: SupabaseClient, limit: number, cursor: string | undefined): Promise<MedicinePage> {
  const offset = decodeCursor(cursor);
  const { data, error } = await supabase
    .from("products")
    .select(SLIM_COLUMNS)
    .eq("is_active", true)
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + limit); // limit + 1 rows
  if (error) throw error;
  return slicePage(((data ?? []) as unknown as Row[]).map(toSlim), offset, limit);
}

/** The server search: every word must be in the search text or the dosage form (the same rule as the product list). */
export async function searchMedicines(supabase: SupabaseClient, q: string, limit: number, cursor: string | undefined): Promise<MedicinePage> {
  const offset = decodeCursor(cursor);
  let request = supabase.from("products").select(SLIM_COLUMNS).eq("is_active", true);
  for (const token of searchTokens(q)) {
    const pattern = quoteFilterValue(`%${escapeLike(token)}%`);
    request = request.or(`search_text.ilike.${pattern},dosage_form.ilike.${pattern}`);
  }
  const { data, error } = await request
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + limit);
  if (error) throw error;
  return slicePage(((data ?? []) as unknown as Row[]).map(toSlim), offset, limit);
}
