import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import type { MarketList, MarketStatusFilter, MarketSummary, PurchaseEntries } from "../../src/lib/market/types";
import type { LineInput } from "./orders";
import { createPendingOrder, refetch, type PendingOrder } from "./pending-db";
import { withRole } from "./pglite";

// ---------------------------------------------------------------------------------------------------
// Calling the Module 005 functions on PGlite as a signed-in user (what PostgREST does for a request).
// ---------------------------------------------------------------------------------------------------

/** A Pakistan local time on a given Pakistan day, as a UTC instant (Pakistan is UTC+05:00 all year). */
export function pkt(date: string, time = "12:00"): string {
  return new Date(`${date}T${time}:00+05:00`).toISOString();
}

/** Today in Pakistan, YYYY-MM-DD (the same rule as the database). */
export function todayPkt(now: Date = new Date()): string {
  return new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** The Pakistan day before or after a Pakistan day. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface MarketFilters {
  date: string;
  q?: string | null;
  status?: MarketStatusFilter | null;
  stores?: string[] | null;
}

export async function dbMarketList(db: PGlite, userId: string, f: MarketFilters): Promise<MarketList> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: MarketList }>(`select public.market_list($1::date, $2, $3, $4::uuid[]) as r`, [
      f.date,
      f.q ?? null,
      f.status ?? "all",
      f.stores ?? null,
    ]);
    return res.rows[0].r;
  });
}

export async function dbMarketSummary(db: PGlite, userId: string, date: string): Promise<MarketSummary> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: MarketSummary }>(`select public.market_summary($1::date) as r`, [date]);
    return res.rows[0].r;
  });
}

export interface RecordInput {
  id?: string;
  product: string;
  unit?: string;
  date: string;
  quantity: number;
  unit_cost?: string | null;
  supplier?: string | null;
  reference?: string | null;
}

export interface PurchaseFnResult {
  done?: boolean;
  replayed?: boolean;
  reason?: string;
  fields?: Record<string, string>;
  entry?: {
    id: string;
    product_id: string;
    unit: string;
    purchase_date: string;
    quantity: number;
    unit_cost: string | null;
    supplier_name: string | null;
    reference: string | null;
    created_at: string;
    recorded_by_me: boolean;
    cancelled: boolean;
    void: { reason: string; voided_at: string; by_me: boolean } | null;
  };
}

export async function dbRecord(db: PGlite, userId: string, input: RecordInput): Promise<PurchaseFnResult> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: PurchaseFnResult }>(
      `select public.purchase_record($1::uuid, $2::uuid, $3, $4::date, $5::int, $6, $7, $8) as r`,
      [
        input.id ?? randomUUID(),
        input.product,
        input.unit ?? "strip",
        input.date,
        input.quantity,
        input.unit_cost ?? null,
        input.supplier ?? null,
        input.reference ?? null,
      ],
    );
    return res.rows[0].r;
  });
}

export async function dbVoid(db: PGlite, userId: string, entryId: string, reason: string | null): Promise<PurchaseFnResult> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: PurchaseFnResult }>(`select public.purchase_void($1::uuid, $2) as r`, [entryId, reason]);
    return res.rows[0].r;
  });
}

export async function dbEntries(
  db: PGlite,
  userId: string,
  product: string,
  unit: string,
  date: string,
): Promise<(PurchaseEntries & { found: boolean }) | { found: false }> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: (PurchaseEntries & { found: boolean }) | { found: false } }>(
      `select public.purchase_entries_list($1::uuid, $2, $3::date) as r`,
      [product, unit, date],
    );
    return res.rows[0].r;
  });
}

/**
 * Creates an order through the real order functions, confirms it, and then moves `confirmed_at` to the wanted
 * instant with a direct update by the table owner (the order guard does not protect confirmed_at), so a test can
 * place an order on any Pakistan day or time. Leave `confirmedAt` out to keep the real confirmation time.
 */
export async function seedConfirmedOrder(
  db: PGlite,
  userId: string,
  storeId: string,
  lines: LineInput[],
  confirmedAt?: string,
): Promise<PendingOrder> {
  const order = await createPendingOrder(db, userId, storeId, lines, { confirm: true });
  if (!confirmedAt) return order;
  await setConfirmedAt(db, order.id, confirmedAt);
  // The direct update bumped the order version, so hand back the current order for later edits and cancels.
  return { ...order, order: await refetch(db, userId, order.id) };
}

export async function setConfirmedAt(db: PGlite, orderId: string, instant: string): Promise<void> {
  await db.query(`update public.orders set confirmed_at = $2::timestamptz where id = $1`, [orderId, instant]);
}

/** A draft order (never confirmed). */
export async function seedDraftOrder(db: PGlite, userId: string, storeId: string, lines: LineInput[]): Promise<PendingOrder> {
  return createPendingOrder(db, userId, storeId, lines);
}

/** Every key of a JSON value at any depth, for the "no price or cost on the list" checks. */
export function allKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, into);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      into.add(key);
      allKeys(child, into);
    }
  }
  return into;
}

/** Keys whose names suggest money. The list, summary, print data and CSV must have none. */
export function moneyKeys(value: unknown): string[] {
  return [...allKeys(value)].filter((k) => /price|cost|mrp|margin|profit/i.test(k));
}
