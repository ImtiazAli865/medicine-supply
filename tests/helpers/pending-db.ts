import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import type { Order } from "../../src/lib/orders/types";
import { dbConfirm, dbGet, dbSave } from "./orders-db";
import { savePayload, typedLine, catalogLine, type LineInput } from "./orders";
import { linkArgs, priceArgs, registerArgs, type LinkBody, type PriceBody, type RegisterBody } from "./pending";
import { withRole } from "./pglite";

// ---------------------------------------------------------------------------------------------------
// Calling the Module 004 functions on PGlite as a signed-in user (what PostgREST does for a request).
// ---------------------------------------------------------------------------------------------------

export interface BriefProduct {
  id: string;
  name: string;
  unit: string;
  strength: string | null;
  dosage_form: string | null;
  pack_size: string | null;
  manufacturer: string | null;
  selling_price: string | null;
  is_active: boolean;
}

export interface WaitingLine {
  line_id: string;
  order_id: string;
  order_number: number;
  store_name: string;
  quantity: number;
  line_total: string;
}

export interface PendingResult {
  done?: boolean;
  ok?: boolean;
  replayed?: boolean;
  reason?: string;
  fields?: Record<string, string>;
  matches?: BriefProduct[];
  current?: Order;
  current_price?: string;
  current_lines?: WaitingLine[];
  product?: BriefProduct;
  price_applied?: boolean;
  order?: Order;
  filled_count?: number;
  orders_touched?: number;
  filled?: WaitingLine[];
  // preview
  price?: string;
  lines?: WaitingLine[];
  untouched_priced_lines?: number;
  total_waiting?: number;
  batch_limit?: number;
}

async function one<T>(db: PGlite, userId: string, sql: string, params: unknown[]): Promise<T> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: T }>(sql, params);
    return res.rows[0].r;
  });
}

export function dbRegister(db: PGlite, userId: string, orderId: string, lineId: string, body: RegisterBody): Promise<PendingResult> {
  const a = registerArgs(orderId, lineId, body);
  return one<PendingResult>(db, userId, `select public.pending_line_register($1, $2, $3, $4, $5::jsonb, $6, $7) as r`, [
    a.p_order, a.p_line, a.p_request_id, a.p_expected_version, JSON.stringify(a.p_product), a.p_confirm_similar, a.p_apply_price,
  ]);
}

export function dbLink(db: PGlite, userId: string, orderId: string, lineId: string, body: LinkBody): Promise<PendingResult> {
  const a = linkArgs(orderId, lineId, body);
  return one<PendingResult>(db, userId, `select public.pending_line_link($1, $2, $3, $4, $5, $6, $7) as r`, [
    a.p_order, a.p_line, a.p_request_id, a.p_expected_version, a.p_product_id, a.p_apply_price, a.p_how,
  ]);
}

export function dbPriceApply(db: PGlite, userId: string, productId: string, body: PriceBody): Promise<PendingResult> {
  const a = priceArgs(productId, body);
  return one<PendingResult>(db, userId, `select public.pending_price_apply($1, $2, $3, $4::uuid[], $5) as r`, [
    a.p_product, a.p_price, a.p_request_id, a.p_line_ids, a.p_fill_lines,
  ]);
}

export function dbPriceApplyRaw(db: PGlite, userId: string, productId: string, price: string, lineIds: string[], fill: boolean, requestId: string = randomUUID()): Promise<PendingResult> {
  return dbPriceApply(db, userId, productId, { request_id: requestId, price, line_ids: lineIds, fill_lines: fill });
}

export function dbPreview(db: PGlite, userId: string, productId: string, price: string): Promise<PendingResult> {
  return one<PendingResult>(db, userId, `select public.pending_price_preview($1, $2) as r`, [productId, price]);
}

export interface Summary {
  typed_lines: number;
  typed_groups: number;
  price_items: number;
  price_items_with_waiting_lines: number;
  lines_waiting: number;
}

export function dbSummary(db: PGlite, userId: string): Promise<Summary> {
  return one<Summary>(db, userId, `select public.pending_summary() as r`, []);
}

export interface TypedLineRow {
  line_id: string;
  order_id: string;
  order_number: number;
  order_status: string;
  store_id?: string;
  store_name: string;
  typed_text: string;
  quantity: number;
  unit: string;
}

export interface TypedGroupsResult {
  items: Array<{ typed_text: string; line_count: number; lines: TypedLineRow[] }>;
  next_offset: number | null;
}

export function dbTypedGroups(db: PGlite, userId: string, q: string | null = null, limit = 50, offset = 0): Promise<TypedGroupsResult> {
  return one<TypedGroupsResult>(db, userId, `select public.pending_typed_groups($1, $2, $3) as r`, [q, limit, offset]);
}

export interface PriceItem {
  product_id: string;
  name: string;
  selling_price: string | null;
  lines_waiting: number;
  orders_waiting: number;
}

export function dbPricesList(db: PGlite, userId: string, q: string | null = null, onlyWaiting = false, limit = 50, offset = 0): Promise<{ items: PriceItem[]; next_offset: number | null }> {
  return one(db, userId, `select public.pending_prices_list($1, $2, $3, $4) as r`, [q, onlyWaiting, limit, offset]);
}

export function dbCandidates(db: PGlite, userId: string, productId: string): Promise<{ ok: boolean; reason?: string; proposed: TypedLineRow[]; not_proposed: TypedLineRow[] }> {
  return one(db, userId, `select public.pending_candidates($1) as r`, [productId]);
}

// ---------------------------------------------------------------------------------------------------
// Seeding orders in PGlite through the real order functions
// ---------------------------------------------------------------------------------------------------

export interface PendingOrder {
  id: string;
  order: Order;
  lineIds: string[];
}

/** Creates a draft with the given lines (typed or catalog) and optionally confirms it. */
export async function createPendingOrder(
  db: PGlite,
  userId: string,
  storeId: string,
  lines: LineInput[],
  options: { confirm?: boolean } = {},
): Promise<PendingOrder> {
  const id = randomUUID();
  const saved = await dbSave(db, userId, id, savePayload(storeId, lines));
  if (saved.saved !== true || !saved.order) throw new Error(`createPendingOrder refused: ${JSON.stringify(saved)}`);
  let order = saved.order;
  if (options.confirm) {
    const confirmed = await dbConfirm(db, userId, id, order.version);
    if (confirmed.confirmed !== true || !confirmed.order) throw new Error(`confirm refused: ${JSON.stringify(confirmed)}`);
    order = confirmed.order;
  }
  return { id, order, lineIds: order.lines.map((l) => l.id) };
}

export async function refetch(db: PGlite, userId: string, orderId: string): Promise<Order> {
  const order = await dbGet(db, userId, orderId);
  if (!order) throw new Error("order not found");
  return order;
}

export { typedLine, catalogLine };

/** Adds a store directly (table owner) and returns its id. */
export async function insertStore(db: PGlite, businessId: string, name: string): Promise<string> {
  const id = randomUUID();
  await db.query(`insert into public.stores (id, business_id, name) values ($1, $2, $3)`, [id, businessId, name]);
  return id;
}

/** Adds a medicine directly (table owner) and returns its id. */
export async function insertMedicine(db: PGlite, businessId: string, fields: Record<string, unknown>): Promise<string> {
  const id = randomUUID();
  const row: Record<string, unknown> = { name: "Medicine", unit: "strip", ...fields, id, business_id: businessId };
  const cols = Object.keys(row);
  await db.query(
    `insert into public.products (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    cols.map((c) => row[c]),
  );
  return id;
}
