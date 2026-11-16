import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, noBusiness, notFound } from "@/lib/api/errors";
import type { CreateInvoiceBody, InvoiceListQuery, ToInvoiceQuery } from "@/lib/validation/invoice";
import type { Invoice, InvoicePage, InvoiceResult, InvoiceSummary, OrderSheet, ToInvoicePage } from "./types";

// Invoices run only through database functions (migration 0007). The functions read the business from the signed-in
// user's session. A refusal comes back as a `reason` that is turned into the documented ApiError here, so every
// screen shows the same wording. No function returns a purchase price, MRP or cost: no invoice table has one.

type FunctionResult = Record<string, unknown>;

async function call(supabase: SupabaseClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (error.message?.includes("no_business")) throw noBusiness();
    throw error;
  }
  return data;
}

/** Turns a refusal reason from an invoice function into an ApiError. */
export function refusal(result: FunctionResult): ApiError {
  const reason = String(result.reason ?? "");
  const current = result.current as Invoice | undefined;
  switch (reason) {
    case "not_found":
    case "line_not_found":
      return notFound();
    case "version_conflict":
      return new ApiError("version_conflict", "This invoice was changed elsewhere. Review the latest version, then try again.", { current });
    case "invoice_not_draft":
      return new ApiError("invoice_not_draft", "This invoice is no longer a draft, so it cannot be changed.", { current });
    case "invoice_not_issued":
      return new ApiError("invoice_not_issued", "Only an issued invoice can be cancelled.");
    case "order_not_confirmed":
      return new ApiError("order_not_confirmed", "The order is no longer confirmed, so this invoice cannot be created or issued.");
    case "order_empty":
      return new ApiError("order_empty", "The order has no lines to bill.");
    case "order_changed":
      return new ApiError("order_changed", "The order has changed, refresh the draft first.");
    case "nothing_to_bill":
      return new ApiError("nothing_to_bill", "Nothing is billed. Set a delivered quantity above 0 on at least one line.");
    case "not_ready":
      return new ApiError("not_ready", "Some billed lines have no verified selling price. Fix them first.", {
        blockers: (result.blockers as unknown[] | undefined) ?? [],
      });
    case "reason_required":
      return new ApiError("reason_required", "Write why this invoice is cancelled.");
    case "invalid_amount":
      return new ApiError("validation_error", "Enter an amount above 0 with at most two decimals.", {
        fields: { payment_received: "Enter an amount above 0 with at most two decimals." },
      });
    case "reason_too_long":
      return new ApiError("validation_error", "Use at most 500 characters.", { fields: { reason: "Use at most 500 characters." } });
    case "invalid_quantity": {
      const fields = (result.fields ?? {}) as Record<string, string>;
      return new ApiError("validation_error", Object.values(fields)[0] ?? "Check the quantities.", { fields });
    }
    case "request_reused":
      return new ApiError("request_reused", "This request was already used for a different invoice. Please try again.");
    default:
      return new ApiError("server_error", "Something went wrong. Please try again.");
  }
}

function succeeded(result: FunctionResult): InvoiceResult {
  if (result.done !== true) throw refusal(result);
  return result as unknown as InvoiceResult;
}

/** Creates the draft of a confirmed order. The body's id is the request id; `existing` means the order already had one. */
export async function createInvoice(supabase: SupabaseClient, body: CreateInvoiceBody): Promise<InvoiceResult> {
  return succeeded((await call(supabase, "invoice_create", { p_id: body.id, p_order_id: body.order_id })) as FunctionResult);
}

export async function getInvoice(supabase: SupabaseClient, id: string): Promise<Invoice> {
  const data = (await call(supabase, "invoice_get", { p_id: id })) as ({ found: true } & Invoice) | { found: false };
  if (!data.found) throw notFound();
  const { found: _found, ...invoice } = data;
  void _found;
  return invoice as Invoice;
}

export async function updateQuantities(
  supabase: SupabaseClient,
  id: string,
  body: { expected_version: number; lines: Array<{ line_id: string; delivered_quantity: number }> },
): Promise<InvoiceResult> {
  return succeeded((await call(supabase, "invoice_set_quantities", { p_id: id, p_expected_version: body.expected_version, p_lines: body.lines })) as FunctionResult);
}

export async function refreshInvoice(supabase: SupabaseClient, id: string, expectedVersion: number): Promise<InvoiceResult> {
  return succeeded((await call(supabase, "invoice_refresh", { p_id: id, p_expected_version: expectedVersion })) as FunctionResult);
}

/** Discards a draft. Returns the order's id so the screen can go back to it. */
export async function discardInvoice(supabase: SupabaseClient, id: string, expectedVersion: number): Promise<{ done: true; order_id: string }> {
  const result = (await call(supabase, "invoice_discard", { p_id: id, p_expected_version: expectedVersion })) as FunctionResult;
  if (result.done !== true) throw refusal(result);
  return result as unknown as { done: true; order_id: string };
}

/** Issues a draft. An optional payment received now is recorded in the same operation (all or nothing). */
export async function issueInvoice(supabase: SupabaseClient, id: string, expectedVersion: number, paymentReceived: string | null = null): Promise<InvoiceResult> {
  return succeeded(
    (await call(supabase, "invoice_issue", { p_id: id, p_expected_version: expectedVersion, p_payment: paymentReceived })) as FunctionResult,
  );
}

export async function cancelInvoice(supabase: SupabaseClient, id: string, reason: string): Promise<InvoiceResult> {
  return succeeded((await call(supabase, "invoice_cancel", { p_id: id, p_reason: reason })) as FunctionResult);
}

export async function listInvoices(supabase: SupabaseClient, query: InvoiceListQuery): Promise<InvoicePage> {
  return (await call(supabase, "invoice_list", {
    p_status: query.status,
    p_store: query.store ?? null,
    p_from: query.from ?? null,
    p_to: query.to ?? null,
    p_order: query.order ?? null,
    p_q: query.q === "" ? null : query.q,
    p_limit: query.limit,
    p_offset: query.offset,
    p_payment_status: query.payment_status === "all" ? null : query.payment_status,
  })) as InvoicePage;
}

export async function listToInvoice(supabase: SupabaseClient, query: ToInvoiceQuery): Promise<ToInvoicePage> {
  return (await call(supabase, "invoice_todo", {
    p_q: query.q === "" ? null : query.q,
    p_limit: query.limit,
    p_offset: query.offset,
  })) as ToInvoicePage;
}

export async function getInvoiceSummary(supabase: SupabaseClient): Promise<InvoiceSummary> {
  return (await call(supabase, "invoice_summary", {})) as InvoiceSummary;
}

/** Order sheet data for options A and B. Quantities and units only. */
export async function getOrderSheet(supabase: SupabaseClient, orderIds: string[]): Promise<OrderSheet> {
  return (await call(supabase, "order_sheet", { p_order_ids: orderIds })) as OrderSheet;
}

export async function getOrderSheetDay(supabase: SupabaseClient, date: string, stores: string[]): Promise<OrderSheet> {
  return (await call(supabase, "order_sheet_day", { p_date: date, p_stores: stores.length > 0 ? stores : null })) as OrderSheet;
}
