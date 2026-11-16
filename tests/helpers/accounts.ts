import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { invoiceArgs } from "./invoices";
import { seedMedicineWithClient, seedOrderWithClient, seedStoreWithClient } from "./pending";

// Shared pieces of the store account tests (Supabase integration and the browser tests).
// The pieces that are common with the invoice tests are re-exported from there.
export { FORBIDDEN_KEY, FORBIDDEN_WORDS, money, scanForbiddenKeys } from "./invoices";

/** The amounts used by several tests so the carry-forward example of the master prompt reads the same everywhere. */
export const EXAMPLE = {
  firstGoods: "20000.00",
  firstPayment: "15000.00",
  secondGoods: "8000.00",
  secondPayment: "10000.00",
} as const;

/** Argument objects for the Supabase `rpc` calls of the ledger functions (named arguments, like PostgREST). */
export const accountArgs = {
  opening: (id: string, storeId: string, amount: string, direction: "owes" | "advance", asOn: string, note: string | null = null) => ({
    p_id: id,
    p_store_id: storeId,
    p_amount: amount,
    p_direction: direction,
    p_as_on: asOn,
    p_note: note,
  }),
  payment: (id: string, storeId: string, amount: string, date: string, reference: string | null = null, method = "cash") => ({
    p_id: id,
    p_store_id: storeId,
    p_amount: amount,
    p_date: date,
    p_method: method,
    p_reference: reference,
  }),
  adjustment: (id: string, storeId: string, amount: string, direction: "reduce" | "increase", reason: string | null, date: string | null = null) => ({
    p_id: id,
    p_store_id: storeId,
    p_amount: amount,
    p_direction: direction,
    p_reason: reason,
    p_date: date,
  }),
  reverse: (id: string, entryId: string, reason: string | null) => ({ p_id: id, p_entry_id: entryId, p_reason: reason }),
  issueWithPayment: (id: string, version: number, payment: string | null) => ({
    p_id: id,
    p_expected_version: version,
    p_payment: payment,
  }),
  statement: (storeId: string, from: string, to: string) => ({ p_store: storeId, p_from: from, p_to: to }),
};

/** A new entry id (the request id of a write). */
export function newEntryId(): string {
  return randomUUID();
}

export interface IssuedWithClient {
  storeId: string;
  invoiceId: string;
  version: number;
  total: string;
  numberLabel: string | null;
}

/**
 * A confirmed order of the store whose total is exactly `total` (one line of quantity 1 of a new medicine priced at
 * that amount), a draft through the real invoice functions, and the invoice issued, optionally with a payment.
 * The signed-in client runs every real function, so every row is legitimate. Fails the test when a step is refused.
 */
export async function issueInvoiceWithClient(
  client: SupabaseClient,
  storeId: string,
  total: string,
  options: { payment?: string | null } = {},
): Promise<IssuedWithClient> {
  const productId = await seedMedicineWithClient(client, {
    name: `Seed medicine ${randomUUID().slice(0, 8)}`,
    unit: "strip",
    selling_price: total,
  });
  const order = await seedOrderWithClient(client, storeId, [{ product_id: productId, quantity: 1, unit: "strip" }], { confirm: true });
  const invoiceId = randomUUID();
  const created = await client.rpc("invoice_create", invoiceArgs.create(invoiceId, order.orderId));
  if (created.error || created.data?.done !== true) throw new Error(`invoice_create: ${created.error?.message ?? JSON.stringify(created.data)}`);
  const issued = await client.rpc("invoice_issue", accountArgs.issueWithPayment(invoiceId, created.data.invoice.version, options.payment ?? null));
  if (issued.error || issued.data?.done !== true) throw new Error(`invoice_issue: ${issued.error?.message ?? JSON.stringify(issued.data)}`);
  return {
    storeId,
    invoiceId,
    version: issued.data.invoice.version,
    total,
    numberLabel: issued.data.invoice.number_label ?? null,
  };
}

/** A store for a signed-in client (a unique name). */
export async function seedAccountStoreWithClient(client: SupabaseClient, name?: string): Promise<string> {
  return seedStoreWithClient(client, name ?? `Store ${randomUUID().slice(0, 6)}`);
}

/** A draft invoice (not issued) of exactly `total` for the store, made through the real functions. */
export async function draftInvoiceWithClient(client: SupabaseClient, storeId: string, total: string): Promise<{ invoiceId: string; version: number }> {
  const productId = await seedMedicineWithClient(client, {
    name: `Seed medicine ${randomUUID().slice(0, 8)}`,
    unit: "strip",
    selling_price: total,
  });
  const order = await seedOrderWithClient(client, storeId, [{ product_id: productId, quantity: 1, unit: "strip" }], { confirm: true });
  const invoiceId = randomUUID();
  const created = await client.rpc("invoice_create", invoiceArgs.create(invoiceId, order.orderId));
  if (created.error || created.data?.done !== true) throw new Error(`invoice_create: ${created.error?.message ?? JSON.stringify(created.data)}`);
  return { invoiceId, version: created.data.invoice.version as number };
}
