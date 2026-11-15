import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import type {
  Invoice,
  InvoicePage,
  InvoiceResult,
  InvoiceSummary,
  OrderSheet,
  ToInvoicePage,
} from "../../src/lib/invoices/types";
import { catalogLine, type LineInput, type Seeded } from "./orders";
import { createPendingOrder, insertMedicine, insertStore, type PendingOrder } from "./pending-db";
import { withRole, type Tenant } from "./pglite";

// ---------------------------------------------------------------------------------------------------
// Calling the Module 006 functions on PGlite as a signed-in user (what PostgREST does for a request).
// ---------------------------------------------------------------------------------------------------

/** What every write function returns: a success with the invoice, or a refusal with a reason. */
export type InvoiceFnResult = Partial<InvoiceResult> & {
  done?: boolean;
  reason?: string;
  fields?: Record<string, string>;
  line_id?: string;
  blockers?: Array<{ line_id: string; name: string; reason: string }>;
  current?: Invoice;
};

async function one<T>(db: PGlite, userId: string, sql: string, params: unknown[]): Promise<T> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: T }>(sql, params);
    return res.rows[0].r;
  });
}

export function dbInvoiceCreate(db: PGlite, userId: string, orderId: string, id: string = randomUUID()): Promise<InvoiceFnResult> {
  return one(db, userId, `select public.invoice_create($1::uuid, $2::uuid) as r`, [id, orderId]);
}

export function dbInvoiceSetQuantities(
  db: PGlite,
  userId: string,
  id: string,
  version: number | null,
  lines: Array<{ line_id: string; delivered_quantity: unknown }>,
): Promise<InvoiceFnResult> {
  return one(db, userId, `select public.invoice_set_quantities($1::uuid, $2::int, $3::jsonb) as r`, [id, version, JSON.stringify(lines)]);
}

export function dbInvoiceRefresh(db: PGlite, userId: string, id: string, version: number | null): Promise<InvoiceFnResult> {
  return one(db, userId, `select public.invoice_refresh($1::uuid, $2::int) as r`, [id, version]);
}

export function dbInvoiceDiscard(db: PGlite, userId: string, id: string, version: number | null): Promise<InvoiceFnResult> {
  return one(db, userId, `select public.invoice_discard($1::uuid, $2::int) as r`, [id, version]);
}

export function dbInvoiceIssue(db: PGlite, userId: string, id: string, version: number | null): Promise<InvoiceFnResult> {
  return one(db, userId, `select public.invoice_issue($1::uuid, $2::int) as r`, [id, version]);
}

export function dbInvoiceCancel(db: PGlite, userId: string, id: string, reason: string | null): Promise<InvoiceFnResult> {
  return one(db, userId, `select public.invoice_cancel($1::uuid, $2) as r`, [id, reason]);
}

export type InvoiceGet = ({ found: true } & Invoice) | { found: false };

export function dbInvoiceGet(db: PGlite, userId: string, id: string): Promise<InvoiceGet> {
  return one(db, userId, `select public.invoice_get($1::uuid) as r`, [id]);
}

export interface InvoiceListFilters {
  status?: string | null;
  store?: string | null;
  from?: string | null;
  to?: string | null;
  order?: string | null;
  q?: string | null;
  limit?: number;
  offset?: number;
}

export function dbInvoiceList(db: PGlite, userId: string, f: InvoiceListFilters = {}): Promise<InvoicePage> {
  return one(db, userId, `select public.invoice_list($1, $2::uuid, $3::date, $4::date, $5::uuid, $6, $7::int, $8::int) as r`, [
    f.status ?? "all", f.store ?? null, f.from ?? null, f.to ?? null, f.order ?? null, f.q ?? null, f.limit ?? 50, f.offset ?? 0,
  ]);
}

export function dbInvoiceTodo(db: PGlite, userId: string, q: string | null = null, limit = 50, offset = 0): Promise<ToInvoicePage> {
  return one(db, userId, `select public.invoice_todo($1, $2::int, $3::int) as r`, [q, limit, offset]);
}

export function dbInvoiceSummary(db: PGlite, userId: string): Promise<InvoiceSummary> {
  return one(db, userId, `select public.invoice_summary() as r`, []);
}

export function dbInvoicesOfOrder(db: PGlite, userId: string, orderId: string): Promise<unknown> {
  return one(db, userId, `select public.invoice_orders_summary($1::uuid) as r`, [orderId]);
}

export function dbOrderSheet(db: PGlite, userId: string, orderIds: string[]): Promise<OrderSheet> {
  return one(db, userId, `select public.order_sheet($1::uuid[]) as r`, [orderIds]);
}

export function dbOrderSheetDay(db: PGlite, userId: string, date: string, stores: string[] | null = null): Promise<OrderSheet> {
  return one(db, userId, `select public.order_sheet_day($1::date, $2::uuid[]) as r`, [date, stores]);
}

// ---------------------------------------------------------------------------------------------------
// Seeding: confirmed orders through the real order functions, so every row is legitimate
// ---------------------------------------------------------------------------------------------------

export interface InvoiceSeed {
  seeded: Seeded;
  /** The medicine names, each made unique with a short suffix so one business can have many seeds. */
  names: { priced: string; sellingOnly: string; noPrice: string };
  order: PendingOrder;
}

/** One store and three medicines of a business (unique names), inserted directly as the table owner. */
export async function seedStoreAndMedicines(db: PGlite, businessId: string, storeName?: string): Promise<{ seeded: Seeded; names: InvoiceSeed["names"] }> {
  const suffix = randomUUID().slice(0, 6);
  const names = { priced: `Panadol 500mg ${suffix}`, sellingOnly: `Brufen 400mg ${suffix}`, noPrice: `Calpol Syrup ${suffix}` };
  const storeId = await insertStore(db, businessId, storeName ?? `Store ${suffix}`);
  const pricedId = await insertMedicine(db, businessId, {
    name: names.priced, unit: "strip", strength: "500 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK",
    purchase_price: "90.00", selling_price: "125.50", mrp: "130.00",
  });
  const sellingOnlyId = await insertMedicine(db, businessId, {
    name: names.sellingOnly, unit: "box", strength: "400 mg", dosage_form: "tablet", selling_price: "310.00",
    purchase_price: "200.00", mrp: "350.00",
  });
  const noPriceId = await insertMedicine(db, businessId, { name: names.noPrice, unit: "bottle", dosage_form: "syrup" });
  return { seeded: { storeId, pricedId, sellingOnlyId, noPriceId }, names };
}

/**
 * One store and three medicines (Panadol 125.50, Brufen 310.00, Calpol with no price; the first two also carry a
 * purchase price and an MRP so the no-cost tests have recognisable values to look for), then a confirmed order with
 * the given lines. By default the lines are 10 x Panadol and 5 x Brufen (both priced), so the draft total is
 * 10 x 125.50 + 5 x 310.00 = 2805.00.
 */
export async function seedInvoiceOrder(
  db: PGlite,
  tenant: Tenant,
  options: { lines?: (s: Seeded) => LineInput[]; confirm?: boolean; storeName?: string } = {},
): Promise<InvoiceSeed> {
  const { seeded, names } = await seedStoreAndMedicines(db, tenant.businessId, options.storeName);
  const lines = options.lines ? options.lines(seeded) : [catalogLine(seeded.pricedId, 10, "strip"), catalogLine(seeded.sellingOnlyId, 5, "box")];
  const order = await createPendingOrder(db, tenant.userId, seeded.storeId, lines, { confirm: options.confirm ?? true });
  return { seeded, names, order };
}

/** A second confirmed order for the same store and medicines (a later invoice). */
export async function seedMoreOrder(
  db: PGlite,
  tenant: Tenant,
  seeded: Seeded,
  lines: LineInput[],
  confirm = true,
): Promise<PendingOrder> {
  return createPendingOrder(db, tenant.userId, seeded.storeId, lines, { confirm });
}

/** Adds a priced medicine directly (table owner) and returns its id. */
export async function addPricedMedicine(db: PGlite, businessId: string, name: string, sellingPrice: string | null): Promise<string> {
  return insertMedicine(db, businessId, { name, unit: "strip", selling_price: sellingPrice });
}

export { insertStore };

/** Creates a draft for an order and fails the test when it was refused. Returns the invoice. */
export async function createInvoiceDraft(db: PGlite, userId: string, orderId: string, id: string = randomUUID()): Promise<Invoice> {
  const res = await dbInvoiceCreate(db, userId, orderId, id);
  if (res.done !== true || !res.invoice) throw new Error(`invoice_create refused: ${JSON.stringify(res)}`);
  return res.invoice;
}

/** Issues a draft and fails the test when it was refused. Returns the issued invoice. */
export async function issueInvoice(db: PGlite, userId: string, invoice: Invoice): Promise<Invoice> {
  const res = await dbInvoiceIssue(db, userId, invoice.id, invoice.version);
  if (res.done !== true || !res.invoice) throw new Error(`invoice_issue refused: ${JSON.stringify(res)}`);
  return res.invoice;
}
