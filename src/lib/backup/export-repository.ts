import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeCursor } from "@/lib/api/paging";
import type { BackupOrder, BackupStore } from "./file";

// Reads the signed-in business's stores and orders for the backup file (Module 009). It runs as the signed-in user, so row
// level security keeps every other business out, and it selects an explicit list of columns: never a price snapshot, a
// purchase price, an MRP or any other money column.

export const ORDER_COLUMNS = "id,order_number,source,status,notes,confirmed_at,cancelled_at,cancel_reason,created_at,updated_at,version,store_id";
export const LINE_COLUMNS = "id,position,product_id,name,strength,dosage_form,pack_size,manufacturer,quantity,unit,delivered_quantity";
export const STORE_COLUMNS = "id,name,contact_person,phone,address,is_active";

const STORE_BLOCK = 1000;
const MAX_STORE_BLOCKS = 5;

type Row = Record<string, unknown>;

export interface ExportPage {
  exported_at: string;
  stores: BackupStore[];
  orders: BackupOrder[];
  next_cursor: string | null;
}

async function allStores(supabase: SupabaseClient): Promise<BackupStore[]> {
  const out: BackupStore[] = [];
  for (let block = 0; block < MAX_STORE_BLOCKS; block += 1) {
    const { data, error } = await supabase
      .from("stores")
      .select(STORE_COLUMNS)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(block * STORE_BLOCK, block * STORE_BLOCK + STORE_BLOCK - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Row[];
    for (const r of rows) {
      out.push({
        id: r.id as string,
        name: r.name as string,
        contact_person: (r.contact_person as string | null) ?? null,
        phone: (r.phone as string | null) ?? null,
        address: (r.address as string | null) ?? null,
        is_active: r.is_active as boolean,
      });
    }
    if (rows.length < STORE_BLOCK) break;
  }
  return out;
}

function toOrder(row: Row & { order_lines?: Row[] }): BackupOrder {
  const lines = [...(row.order_lines ?? [])].sort((a, b) => (a.position as number) - (b.position as number));
  return {
    id: row.id as string,
    order_number: row.order_number as number,
    status: row.status as BackupOrder["status"],
    source: row.source as "manual" | "voice",
    notes: (row.notes as string | null) ?? null,
    version: row.version as number,
    store_id: row.store_id as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    confirmed_at: (row.confirmed_at as string | null) ?? null,
    cancelled_at: (row.cancelled_at as string | null) ?? null,
    cancel_reason: (row.cancel_reason as string | null) ?? null,
    lines: lines.map((l) => ({
      id: l.id as string,
      position: l.position as number,
      product_id: (l.product_id as string | null) ?? null,
      name: l.name as string,
      strength: (l.strength as string | null) ?? null,
      dosage_form: (l.dosage_form as string | null) ?? null,
      pack_size: (l.pack_size as string | null) ?? null,
      manufacturer: (l.manufacturer as string | null) ?? null,
      quantity: l.quantity as number,
      unit: l.unit as string,
      delivered_quantity: (l.delivered_quantity as number | null) ?? null,
    })),
  };
}

/** One page of orders (oldest first, then id) with their lines; the stores come with the first page only. */
export async function exportPage(supabase: SupabaseClient, limit: number, cursor: string | undefined): Promise<ExportPage> {
  const offset = decodeCursor(cursor);
  const { data, error } = await supabase
    .from("orders")
    .select(`${ORDER_COLUMNS},order_lines(${LINE_COLUMNS})`)
    .is("order_lines.removed_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + limit); // limit + 1 rows, the extra one only tells whether another page exists
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<Row & { order_lines?: Row[] }>;
  const hasMore = rows.length > limit;
  return {
    exported_at: new Date().toISOString(),
    stores: offset === 0 ? await allStores(supabase) : [],
    orders: (hasMore ? rows.slice(0, limit) : rows).map(toOrder),
    next_cursor: hasMore ? String(offset + limit) : null,
  };
}
