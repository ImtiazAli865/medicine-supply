import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import type { Order, OrderSummary } from "../../src/lib/orders/types";
import { savePayload, type LineInput, type SavePayload } from "./orders";
import { withRole } from "./pglite";

// ---------------------------------------------------------------------------------------------------
// Calling the order functions on PGlite as a signed-in user (what PostgREST does for a request).
// ---------------------------------------------------------------------------------------------------


export interface FnResult {
  saved?: boolean;
  confirmed?: boolean;
  cancelled?: boolean;
  replayed?: boolean;
  created?: boolean;
  reason?: string;
  order?: Order;
  current?: Order;
  detail?: { message?: string };
}

export async function dbSave(db: PGlite, userId: string, orderId: string, payload: SavePayload): Promise<FnResult> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: FnResult }>(`select public.order_save($1, $2, $3, $4, $5, $6::jsonb) as r`, [
      orderId,
      payload.request_id,
      payload.expected_version,
      payload.store_id,
      payload.notes,
      JSON.stringify(payload.lines),
    ]);
    return res.rows[0].r;
  });
}

export async function dbConfirm(db: PGlite, userId: string, orderId: string, expectedVersion: number | null, requestId: string = randomUUID()): Promise<FnResult> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: FnResult }>(`select public.order_confirm($1, $2, $3) as r`, [orderId, requestId, expectedVersion]);
    return res.rows[0].r;
  });
}

export async function dbCancel(db: PGlite, userId: string, orderId: string, expectedVersion: number | null, reason: string | null, requestId: string = randomUUID()): Promise<FnResult> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: FnResult }>(`select public.order_cancel($1, $2, $3, $4) as r`, [orderId, requestId, expectedVersion, reason]);
    return res.rows[0].r;
  });
}

export async function dbGet(db: PGlite, userId: string, orderId: string): Promise<Order | null> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: Order | null }>(`select public.order_get($1) as r`, [orderId]);
    return res.rows[0].r;
  });
}

export interface ListFilters {
  store?: string | null;
  status?: string | null;
  from?: string | null;
  to?: string | null;
  q?: string | null;
  limit?: number;
  offset?: number;
}

export async function dbList(db: PGlite, userId: string, f: ListFilters = {}): Promise<OrderSummary[]> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: OrderSummary[] }>(`select public.order_list($1, $2, $3, $4, $5, $6, $7) as r`, [
      f.store ?? null, f.status ?? null, f.from ?? null, f.to ?? null, f.q ?? null, f.limit ?? 50, f.offset ?? 0,
    ]);
    return res.rows[0].r;
  });
}

/** Creates a draft in one call and returns it; fails the test when the save was refused. */
export async function createDraft(db: PGlite, userId: string, storeId: string, lines: LineInput[], notes: string | null = null): Promise<{ id: string; order: Order }> {
  const id = randomUUID();
  const res = await dbSave(db, userId, id, savePayload(storeId, lines, { notes }));
  if (res.saved !== true || !res.order) throw new Error(`createDraft refused: ${JSON.stringify(res)}`);
  return { id, order: res.order };
}
