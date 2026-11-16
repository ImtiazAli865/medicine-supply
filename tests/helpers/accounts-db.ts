import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import type {
  AccountPage,
  AccountsSummary,
  AccountView,
  LedgerEntry,
  PaymentPreview,
  Statement,
} from "../../src/lib/accounts/types";
import type { Invoice } from "../../src/lib/invoices/types";
import { createInvoiceDraft, type InvoiceFnResult } from "./invoices-db";
import { catalogLine } from "./orders";
import { createPendingOrder, insertMedicine, insertStore } from "./pending-db";
import { withRole, type Tenant } from "./pglite";

// ---------------------------------------------------------------------------------------------------
// Calling the Module 007 functions on PGlite as a signed-in user (what PostgREST does for a request).
// ---------------------------------------------------------------------------------------------------

/** What every ledger write function returns: a success with the entry, or a refusal with a reason. */
export interface LedgerFnResult {
  done?: boolean;
  reason?: string;
  replayed?: boolean;
  entry?: LedgerEntry;
  reversed?: LedgerEntry;
  account?: { balance: string; advance: boolean };
  fields?: Record<string, string>;
}

async function one<T>(db: PGlite, userId: string, sql: string, params: unknown[]): Promise<T> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: T }>(sql, params);
    return res.rows[0].r;
  });
}

export function dbOpeningAdd(
  db: PGlite,
  userId: string,
  storeId: string,
  amount: unknown,
  direction: string,
  asOn: string,
  note: string | null = null,
  id: string = randomUUID(),
): Promise<LedgerFnResult> {
  return one(db, userId, `select public.ledger_opening_add($1::uuid, $2::uuid, $3::numeric, $4, $5::date, $6) as r`, [
    id, storeId, amount, direction, asOn, note,
  ]);
}

export function dbPaymentAdd(
  db: PGlite,
  userId: string,
  storeId: string,
  amount: unknown,
  date: string,
  options: { method?: string; reference?: string | null; id?: string } = {},
): Promise<LedgerFnResult> {
  return one(db, userId, `select public.ledger_payment_add($1::uuid, $2::uuid, $3::numeric, $4::date, $5, $6) as r`, [
    options.id ?? randomUUID(), storeId, amount, date, options.method ?? "cash", options.reference ?? null,
  ]);
}

export function dbAdjustmentAdd(
  db: PGlite,
  userId: string,
  storeId: string,
  amount: unknown,
  direction: string,
  reason: string | null,
  options: { date?: string | null; id?: string } = {},
): Promise<LedgerFnResult> {
  return one(db, userId, `select public.ledger_adjustment_add($1::uuid, $2::uuid, $3::numeric, $4, $5, $6::date) as r`, [
    options.id ?? randomUUID(), storeId, amount, direction, reason, options.date ?? null,
  ]);
}

export function dbEntryReverse(
  db: PGlite,
  userId: string,
  entryId: string,
  reason: string | null,
  id: string = randomUUID(),
  storeId: string | null = null,
): Promise<LedgerFnResult> {
  return one(db, userId, `select public.ledger_entry_reverse($1::uuid, $2::uuid, $3, $4::uuid) as r`, [id, entryId, reason, storeId]);
}

export type AccountGet = ({ found: true } & AccountView) | { found: false };

export function dbAccount(db: PGlite, userId: string, storeId: string, limit = 50, offset = 0): Promise<AccountGet> {
  return one(db, userId, `select public.ledger_account($1::uuid, $2::int, $3::int) as r`, [storeId, limit, offset]);
}

export function dbStores(
  db: PGlite,
  userId: string,
  options: { q?: string | null; onlyOwing?: boolean; limit?: number; offset?: number } = {},
): Promise<AccountPage> {
  return one(db, userId, `select public.ledger_stores($1, $2::boolean, $3::int, $4::int) as r`, [
    options.q ?? null, options.onlyOwing ?? false, options.limit ?? 50, options.offset ?? 0,
  ]);
}

export function dbSummary(db: PGlite, userId: string): Promise<AccountsSummary> {
  return one(db, userId, `select public.ledger_summary() as r`, []);
}

export type PreviewGet = ({ found: true } & PaymentPreview) | { found: false };

export function dbPaymentPreview(db: PGlite, userId: string, storeId: string, amount: unknown): Promise<PreviewGet> {
  return one(db, userId, `select public.ledger_payment_preview($1::uuid, $2::numeric) as r`, [storeId, amount]);
}

export type StatementGet = ({ found: true } & Statement) | { found: false };

export function dbStatement(db: PGlite, userId: string, storeId: string, from: string, to: string): Promise<StatementGet> {
  return one(db, userId, `select public.ledger_statement($1::uuid, $2::date, $3::date) as r`, [storeId, from, to]);
}

export interface AllocationRow {
  store_id: string;
  entry_id: string;
  kind: string;
  invoice_id: string | null;
  entry_date: string;
  amount: string;
  allocated: string;
  outstanding: string;
  status: string;
}

/** The internal allocation rows of one store (an invoker function, so it runs as the signed-in user). */
export async function dbAllocation(db: PGlite, userId: string, businessId: string, storeId: string | null): Promise<AllocationRow[]> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<AllocationRow>(
      `select store_id, entry_id, kind, invoice_id, entry_date::text as entry_date, amount::text as amount,
              allocated::text as allocated, outstanding::text as outstanding, status
         from public.ledger_allocation($1::uuid, $2::uuid[], 0)
        order by store_id, ord`,
      [businessId, storeId === null ? null : [storeId]],
    );
    return res.rows;
  });
}

// ---------------------------------------------------------------------------------------------------
// Reading the ledger directly as the table owner (to check what the functions wrote)
// ---------------------------------------------------------------------------------------------------

/** The balance of a store worked out straight from the table (sum of debits minus credits), as text. */
export async function balanceOf(db: PGlite, businessId: string, storeId: string): Promise<string> {
  const res = await db.query<{ b: string }>(
    `select (coalesce(sum(debit), 0) - coalesce(sum(credit), 0))::numeric(18,2)::text as b
       from public.ledger_entries where business_id = $1 and store_id = $2`,
    [businessId, storeId],
  );
  return res.rows[0].b;
}

export interface RawEntry {
  id: string;
  store_id: string;
  seq: string;
  entry_type: string;
  entry_date: string;
  debit: string;
  credit: string;
  invoice_id: string | null;
  reverses_entry_id: string | null;
  payment_method: string | null;
  reference: string | null;
  note: string | null;
  created_by: string | null;
}

/** Every entry of a store as stored, in the order they were recorded. */
export async function rawEntries(db: PGlite, businessId: string, storeId?: string): Promise<RawEntry[]> {
  const res = await db.query<RawEntry>(
    `select id, store_id, seq::text as seq, entry_type, entry_date::text as entry_date, debit::text as debit, credit::text as credit,
            invoice_id, reverses_entry_id, payment_method, reference, note, created_by
       from public.ledger_entries
      where business_id = $1 and ($2::uuid is null or store_id = $2)
      order by seq`,
    [businessId, storeId ?? null],
  );
  return res.rows;
}

export async function countEntries(db: PGlite, businessId: string): Promise<number> {
  const res = await db.query<{ n: number }>(`select count(*)::int as n from public.ledger_entries where business_id = $1`, [businessId]);
  return res.rows[0].n;
}

// ---------------------------------------------------------------------------------------------------
// Seeding stores and issued invoices of a chosen total
// ---------------------------------------------------------------------------------------------------

/** A store of the business, inserted directly as the table owner. */
export async function seedAccountStore(db: PGlite, tenant: Tenant, name?: string): Promise<string> {
  return insertStore(db, tenant.businessId, name ?? `Store ${randomUUID().slice(0, 6)}`);
}

/** Issues a draft with an optional payment received now (the third argument of invoice_issue). */
export function dbInvoiceIssueWithPayment(
  db: PGlite,
  userId: string,
  id: string,
  version: number | null,
  payment: unknown,
): Promise<InvoiceFnResult> {
  return one(db, userId, `select public.invoice_issue($1::uuid, $2::int, $3::numeric) as r`, [id, version, payment]);
}

/**
 * A confirmed order of the store whose total is exactly `total` (one line of quantity 1 of a new medicine priced at
 * that amount), a draft, and the invoice issued, optionally with a payment received now. Fails the test when any
 * step is refused. Returns the issued invoice.
 */
export async function issueInvoiceOf(
  db: PGlite,
  tenant: Tenant,
  storeId: string,
  total: string,
  options: { payment?: string | null } = {},
): Promise<Invoice> {
  const productId = await insertMedicine(db, tenant.businessId, {
    name: `Seed medicine ${randomUUID().slice(0, 8)}`,
    unit: "strip",
    selling_price: total,
  });
  const order = await createPendingOrder(db, tenant.userId, storeId, [catalogLine(productId, 1, "strip")], { confirm: true });
  const draft = await createInvoiceDraft(db, tenant.userId, order.id);
  const res = await dbInvoiceIssueWithPayment(db, tenant.userId, draft.id, draft.version, options.payment ?? null);
  if (res.done !== true || !res.invoice) throw new Error(`invoice_issue refused: ${JSON.stringify(res)}`);
  return res.invoice;
}
