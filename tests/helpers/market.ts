import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seedOrderWithClient, type SeededOrder } from "./pending";
import { serviceClient } from "./supabase-test";

// Builders for the market list and purchase tests that use a signed-in Supabase client (the real order and
// purchase functions, so every row is legitimate). The PGlite versions are in market-db.ts.

export { pkt, todayPkt, addDays, moneyKeys, allKeys } from "./market-db";

/**
 * Creates and confirms an order (typed or catalog lines) and, when `confirmedAt` is given, moves its
 * confirmation to that instant with the service role (a test-only shortcut: the app never does this).
 */
export async function seedConfirmedWithClient(
  client: SupabaseClient,
  storeId: string,
  lines: Array<{ product_id: string | null; name?: string; quantity?: number; unit?: string }>,
  confirmedAt?: string,
): Promise<SeededOrder> {
  const order = await seedOrderWithClient(client, storeId, lines, { confirm: true });
  if (confirmedAt) {
    const res = await serviceClient().from("orders").update({ confirmed_at: confirmedAt }).eq("id", order.orderId);
    if (res.error) throw new Error(`move confirmed_at: ${res.error.message}`);
  }
  return order;
}

export interface RecordBody {
  id: string;
  product_id: string;
  unit: string;
  purchase_date: string;
  quantity: number;
  unit_cost?: string | null;
  supplier_name?: string | null;
  reference?: string | null;
}

/** The body of POST /api/purchases. Every call gets a fresh entry id unless one is given. */
export function recordBody(productId: string, purchaseDate: string, quantity: number, overrides: Partial<RecordBody> = {}): RecordBody {
  return { id: randomUUID(), product_id: productId, unit: "strip", purchase_date: purchaseDate, quantity, ...overrides };
}

/** The same body as the arguments of the database function `purchase_record`. */
export function recordArgs(body: RecordBody) {
  return {
    p_id: body.id,
    p_product: body.product_id,
    p_unit: body.unit,
    p_date: body.purchase_date,
    p_quantity: body.quantity,
    p_unit_cost: body.unit_cost ?? null,
    p_supplier: body.supplier_name ?? null,
    p_reference: body.reference ?? null,
  };
}

export function voidArgs(entryId: string, reason: string | null) {
  return { p_entry: entryId, p_reason: reason };
}
