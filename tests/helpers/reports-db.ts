import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createInvoiceDraft, dbInvoiceCancel, dbInvoiceSetQuantities, issueInvoice } from "./invoices-db";
import { dbRecord, dbVoid, pkt } from "./market-db";
import { catalogLine } from "./orders";
import { createPendingOrder, insertMedicine, insertStore } from "./pending-db";
import { withRole, type Tenant } from "./pglite";

// ---------------------------------------------------------------------------------------------------
// Helpers for the Module 010 report tests on PGlite.
//
// Invoices and orders are created through the REAL functions (so every row is legitimate) and are then moved to the
// wanted dates by one helper that switches the triggers off for that single statement (an issued invoice cannot be
// changed through the app, the app always dates an invoice today). Raw inserts, also with the triggers off, build the
// few shapes the real functions refuse (a billed typed line) and the 5,000-invoice scale data set.
// ---------------------------------------------------------------------------------------------------

/** Runs `fn` with every trigger and foreign-key check switched off (table owner only), and always switches them on again. */
export async function withoutTriggers<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec("set session_replication_role = replica");
  try {
    return await fn();
  } finally {
    await db.exec("set session_replication_role = origin");
  }
}

// ---------------------------------------------------------------------------------------------------
// Calling the Module 010 functions as a signed-in user (what PostgREST does for a request)
// ---------------------------------------------------------------------------------------------------

async function one<T>(db: PGlite, userId: string, sql: string, params: unknown[]): Promise<T> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: T }>(sql, params);
    return res.rows[0].r;
  });
}

export interface ListArgs {
  from: string;
  to: string;
  q?: string | null;
  sort?: "sales" | "profit" | "name";
  limit?: number;
  offset?: number;
}

// The result types are loose on purpose: the tests compare exact values, the types in src/lib/reports/types.ts are
// checked by the repository and route tests.
export type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export function dbReportSales(db: PGlite, userId: string, from: string, to: string, group: "day" | "week" | "month" = "day"): Promise<Json> {
  return one(db, userId, `select public.report_sales($1::date, $2::date, $3) as r`, [from, to, group]);
}

export function dbReportPurchases(db: PGlite, userId: string, from: string, to: string, group: "day" | "week" | "month" = "day"): Promise<Json> {
  return one(db, userId, `select public.report_purchases($1::date, $2::date, $3) as r`, [from, to, group]);
}

export function dbReportByStore(db: PGlite, userId: string, a: ListArgs): Promise<Json> {
  return one(db, userId, `select public.report_by_store($1::date, $2::date, $3, $4, $5, $6) as r`, [
    a.from, a.to, a.q ?? null, a.sort ?? "sales", a.limit ?? 20, a.offset ?? 0,
  ]);
}

export function dbReportByMedicine(db: PGlite, userId: string, a: ListArgs): Promise<Json> {
  return one(db, userId, `select public.report_by_medicine($1::date, $2::date, $3, $4, $5, $6) as r`, [
    a.from, a.to, a.q ?? null, a.sort ?? "sales", a.limit ?? 20, a.offset ?? 0,
  ]);
}

export function dbReportCostMissing(db: PGlite, userId: string, from: string, to: string): Promise<Json> {
  return one(db, userId, `select public.report_cost_missing($1::date, $2::date) as r`, [from, to]);
}

export function dbReportNotInAccount(db: PGlite, userId: string): Promise<Json> {
  return one(db, userId, `select public.report_not_in_account() as r`, []);
}

/** The base set of billed lines, as the signed-in user, for the business id given (a crafted id must return nothing). */
export async function dbSalesLines(db: PGlite, userId: string, biz: string, from: string, to: string): Promise<Array<Record<string, unknown>>> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<Record<string, unknown>>(`select * from public.report_sales_lines($1::uuid, $2::date, $3::date)`, [biz, from, to]);
    return res.rows;
  });
}

// ---------------------------------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------------------------------

export interface MedicineSeed {
  name: string;
  unit?: string;
  strength?: string | null;
  dosage_form?: string | null;
  pack_size?: string | null;
  manufacturer?: string | null;
  purchase_price?: string | null;
  selling_price?: string | null;
}

export async function seedMedicine(db: PGlite, businessId: string, m: MedicineSeed): Promise<string> {
  return insertMedicine(db, businessId, { unit: "strip", ...m });
}

export { insertStore };

export interface InvoiceLineSeed {
  product: string;
  unit?: string;
  qty: number;
  /** The selling price of this order line; the medicine's price is set to it before the order is confirmed. */
  price: string;
  /** The purchase price saved on the order line (the Estimate cost); null leaves it empty. */
  purchase?: string | null;
  /** The billed (delivered) quantity when it differs from the ordered one. */
  delivered?: number;
}

export interface InvoiceSeedResult {
  orderId: string;
  invoiceId: string;
  total: string;
}

/** Sets the medicine prices so the next confirmation snapshots them. */
export async function setPrices(db: PGlite, productId: string, prices: { purchase?: string | null; selling?: string | null }): Promise<void> {
  await db.query(`update public.products set purchase_price = $2, selling_price = $3 where id = $1`, [productId, prices.purchase ?? null, prices.selling ?? null]);
}

/** Moves an issued or cancelled invoice and its order to the wanted dates (the app always dates them today). */
export async function backdate(db: PGlite, a: { invoiceId: string; orderId: string; invoiceDate: string; confirmedAt?: string }): Promise<void> {
  await withoutTriggers(db, async () => {
    await db.query(`update public.invoices set invoice_date = $2::date, issued_at = $3::timestamptz where id = $1`, [a.invoiceId, a.invoiceDate, pkt(a.invoiceDate, "11:00")]);
    await db.query(`update public.orders set confirmed_at = $2::timestamptz where id = $1`, [a.orderId, a.confirmedAt ?? pkt(a.invoiceDate, "09:00")]);
  });
}

/**
 * One order and its issued invoice through the real functions, then dated.
 * `date` is the invoice date; `marketDate` (default the same day) is the Pakistan day the order was confirmed.
 * `status` issued (default) leaves it issued, cancelled cancels it (with a reason), draft stops after the draft.
 */
export async function seedIssuedInvoice(
  db: PGlite,
  tenant: Tenant,
  a: { storeId: string; date: string; marketDate?: string; lines: InvoiceLineSeed[]; status?: "issued" | "cancelled" | "draft" },
): Promise<InvoiceSeedResult> {
  for (const l of a.lines) await setPrices(db, l.product, { purchase: l.purchase ?? null, selling: l.price });
  const order = await createPendingOrder(
    db,
    tenant.userId,
    a.storeId,
    a.lines.map((l) => catalogLine(l.product, l.qty, l.unit ?? "strip")),
    { confirm: true },
  );
  const draft = await createInvoiceDraft(db, tenant.userId, order.id);
  // A billed quantity that differs from the ordered one is written on the draft as the app does it (the lines of a draft can change).
  const changed = a.lines.some((l) => l.delivered !== undefined);
  let current = draft;
  if (changed) {
    const lines = draft.lines.map((dl, i) => ({ line_id: dl.id, delivered_quantity: a.lines[i].delivered ?? dl.delivered_quantity }));
    const res = await dbInvoiceSetQuantities(db, tenant.userId, draft.id, draft.version, lines);
    if (res.done !== true || !res.invoice) throw new Error(`invoice_set_quantities refused: ${JSON.stringify(res)}`);
    current = res.invoice;
  }
  if (a.status === "draft") return { orderId: order.id, invoiceId: current.id, total: current.grand_total };
  const issued = await issueInvoice(db, tenant.userId, current);
  if (a.status === "cancelled") {
    const res = await dbInvoiceCancel(db, tenant.userId, issued.id, "wrong quantity");
    if (res.done !== true) throw new Error(`invoice_cancel refused: ${JSON.stringify(res)}`);
  }
  await backdate(db, { invoiceId: issued.id, orderId: order.id, invoiceDate: a.date, confirmedAt: pkt(a.marketDate ?? a.date, "09:00") });
  return { orderId: order.id, invoiceId: issued.id, total: issued.grand_total };
}

/** A purchase through the real function. */
export async function seedPurchase(
  db: PGlite,
  userId: string,
  p: { product: string; unit?: string; date: string; qty: number; unitCost?: string | null },
): Promise<string> {
  const res = await dbRecord(db, userId, { product: p.product, unit: p.unit ?? "strip", date: p.date, quantity: p.qty, unit_cost: p.unitCost ?? null });
  if (res.done !== true || !res.entry) throw new Error(`purchase_record refused: ${JSON.stringify(res)}`);
  return res.entry.id;
}

export async function voidPurchase(db: PGlite, userId: string, entryId: string, reason = "wrong entry"): Promise<void> {
  const res = await dbVoid(db, userId, entryId, reason);
  if (res.done !== true) throw new Error(`purchase_void refused: ${JSON.stringify(res)}`);
}

/**
 * The owner's example (2026-11-24): 23 Nov bought 10 at 50.00 and sold 10 at 55.00; 24 Nov bought 10 at 58.00 and sold
 * 10 at 65.00. Estimates use a saved purchase price of 52.00 on both orders.
 */
export async function seedPanadolExample(db: PGlite, tenant: Tenant): Promise<{ storeId: string; product: string; day1: InvoiceSeedResult; day2: InvoiceSeedResult }> {
  const storeId = await insertStore(db, tenant.businessId, "Al Madina");
  const product = await seedMedicine(db, tenant.businessId, { name: "Panadol 500mg", strength: "500 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK" });
  await seedPurchase(db, tenant.userId, { product, date: "2026-11-23", qty: 10, unitCost: "50.00" });
  const day1 = await seedIssuedInvoice(db, tenant, { storeId, date: "2026-11-23", lines: [{ product, qty: 10, price: "55.00", purchase: "52.00" }] });
  await seedPurchase(db, tenant.userId, { product, date: "2026-11-24", qty: 10, unitCost: "58.00" });
  const day2 = await seedIssuedInvoice(db, tenant, { storeId, date: "2026-11-24", lines: [{ product, qty: 10, price: "65.00", purchase: "52.00" }] });
  return { storeId, product, day1, day2 };
}

let rawNumber = 900_000;

/**
 * An issued invoice written directly (triggers off), for shapes the real functions refuse: a billed typed line or a line
 * with no order line. Needs an order of the same business and store (pass one made by `seedIssuedInvoice` or create one).
 */
export async function insertRawInvoice(
  db: PGlite,
  tenant: Tenant,
  a: {
    orderId: string;
    storeId: string;
    date: string;
    status?: "issued" | "cancelled";
    lines: Array<{ productId: string | null; name: string; unit?: string; qty: number; price: string; orderLineId?: string | null }>;
  },
): Promise<string> {
  const id = randomUUID();
  const total = a.lines.reduce((sum, l) => sum + Math.round(Number(l.price) * 100) * l.qty, 0) / 100;
  await withoutTriggers(db, async () => {
    const live = await db.query(`select 1 from public.invoices where business_id = $1 and order_id = $2 and status in ('draft','issued')`, [tenant.businessId, a.orderId]);
    // Only one live invoice per order: a raw issued invoice on an order that already has one is a test mistake.
    if ((a.status ?? "issued") === "issued" && live.rows.length > 0) throw new Error("the order already has a live invoice");
    await db.query(
      `insert into public.invoices (id, business_id, order_id, store_id, status, invoice_number, invoice_date, issued_at, grand_total, source_fingerprint,
                                    business_name, store_name, cancelled_at, cancel_reason)
       values ($1, $2, $3, $4, $5, $6, $7::date, $8::timestamptz, $9, 'raw', 'Test business', 'Test store', $10, $11)`,
      [id, tenant.businessId, a.orderId, a.storeId, a.status ?? "issued", (rawNumber += 1), a.date, pkt(a.date, "11:00"), total.toFixed(2),
        a.status === "cancelled" ? pkt(a.date, "12:00") : null, a.status === "cancelled" ? "test" : null],
    );
    let position = 0;
    for (const l of a.lines) {
      position += 1;
      await db.query(
        `insert into public.invoice_lines (business_id, invoice_id, position, order_line_id, product_id, name, unit, ordered_quantity, delivered_quantity, selling_price)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)`,
        [tenant.businessId, id, position, l.orderLineId ?? null, l.productId, l.name, l.unit ?? "strip", l.qty, l.price],
      );
    }
  });
  return id;
}

/** A confirmed order with one catalog line, and nothing else (a parent for raw invoices). */
export async function seedBareOrder(db: PGlite, tenant: Tenant, storeId: string, product: string, marketDate: string): Promise<{ orderId: string; orderLineId: string }> {
  const order = await createPendingOrder(db, tenant.userId, storeId, [catalogLine(product, 1)], { confirm: true });
  await withoutTriggers(db, async () => {
    await db.query(`update public.orders set confirmed_at = $2::timestamptz where id = $1`, [order.id, pkt(marketDate, "09:00")]);
  });
  return { orderId: order.id, orderLineId: order.lineIds[0] };
}

/**
 * Many issued invoices at once for the scale tests: `invoices` orders (confirmed, fulfilled), each with `linesEach` order
 * lines and invoice lines over the given products, spread over `days` days ending on `endDate`. Purchases are one entry
 * per product and day with a cost. All inserted directly with the triggers off, in a handful of statements.
 */
export async function bulkInvoices(
  db: PGlite,
  tenant: Tenant,
  a: { storeIds: string[]; products: string[]; invoices: number; linesEach: number; days: number; endDate: string },
): Promise<void> {
  await withoutTriggers(db, async () => {
    await db.exec(`drop table if exists bulk_lines; drop table if exists bulk_seed`);
    await db.query(
      `create temp table bulk_seed as
         select g, gen_random_uuid() as order_id, gen_random_uuid() as invoice_id, ($1::date - (g % $2::int)) as day
           from generate_series(1, $3::int) g`,
      [a.endDate, a.days, a.invoices],
    );
    const stores = `array[${a.storeIds.map((s) => `'${s}'::uuid`).join(",")}]`;
    const products = `array[${a.products.map((p) => `'${p}'::uuid`).join(",")}]`;
    await db.query(
      `insert into public.orders (id, business_id, store_id, order_number, status, confirmed_at, created_at)
         select s.order_id, $1, (${stores})[(s.g % ${a.storeIds.length}) + 1], 800000 + s.g, 'fulfilled',
                (s.day::timestamp + time '09:00') at time zone 'Asia/Karachi', (s.day::timestamp + time '09:00') at time zone 'Asia/Karachi'
           from bulk_seed s`,
      [tenant.businessId],
    );
    await db.query(
      `create temp table bulk_lines as
         select s.g, l as pos, gen_random_uuid() as ol_id, (${products})[((s.g + l) % ${a.products.length}) + 1] as product,
                (1 + ((s.g + l) % 9)) as qty, ((50 + ((s.g + l) % 40)))::numeric(12,2) as price
           from bulk_seed s cross join generate_series(1, ${a.linesEach}) l`,
    );
    await db.query(
      `insert into public.order_lines (id, business_id, order_id, position, product_id, item_status, name, unit, quantity, delivered_quantity,
                                       purchase_price_snapshot, selling_price_snapshot, snapshot_taken_at)
         select b.ol_id, $1, s.order_id, b.pos, b.product, 'registered', 'Medicine', 'strip', b.qty, b.qty,
                (b.price - 8)::numeric(12,2), b.price, now()
           from bulk_lines b join bulk_seed s on s.g = b.g`,
      [tenant.businessId],
    );
    await db.query(
      `insert into public.invoices (id, business_id, order_id, store_id, status, invoice_number, invoice_date, issued_at, grand_total, source_fingerprint, business_name, store_name)
         select s.invoice_id, $1, s.order_id, (${stores})[(s.g % ${a.storeIds.length}) + 1], 'issued', 1000000 + s.g, s.day,
                (s.day::timestamp + time '11:00') at time zone 'Asia/Karachi',
                (select coalesce(sum(b.qty * b.price), 0) from bulk_lines b where b.g = s.g), 'bulk', 'Test business', 'Test store'
           from bulk_seed s`,
      [tenant.businessId],
    );
    await db.query(
      `insert into public.invoice_lines (business_id, invoice_id, position, order_line_id, product_id, name, unit, ordered_quantity, delivered_quantity, selling_price)
         select $1, s.invoice_id, b.pos, b.ol_id, b.product, 'Medicine', 'strip', b.qty, b.qty, b.price
           from bulk_lines b join bulk_seed s on s.g = b.g`,
      [tenant.businessId],
    );
    // One costed purchase per product and day, so most lines have a realized cost.
    await db.query(
      `insert into public.purchase_entries (id, business_id, product_id, unit, purchase_date, quantity, unit_cost)
         select gen_random_uuid(), $1, p.pid, 'strip', d.day, 1000, 45.00
           from unnest(${products}) as p(pid)
           cross join (select distinct day from bulk_seed) d`,
      [tenant.businessId],
    );
    await db.query(`drop table if exists bulk_lines`);
    await db.query(`drop table if exists bulk_seed`);
  });
}
