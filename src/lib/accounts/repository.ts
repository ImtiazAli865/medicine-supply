import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, noBusiness, notFound } from "@/lib/api/errors";
import type {
  AccountListQuery,
  AccountQuery,
  AdjustmentBody,
  OpeningBalanceBody,
  PaymentBody,
  ReverseBody,
  StatementQuery,
} from "@/lib/validation/account";
import type { AccountPage, AccountsSummary, AccountView, EntryResult, PaymentPreview, PaymentResult, Statement } from "./types";

// The store ledger runs only through database functions (migration 0008). The functions read the business from the
// signed-in user's session. A refusal comes back as a `reason` that is turned into the documented ApiError here, so
// every screen shows the same wording. No function returns a purchase price, MRP or cost: no ledger table has one.

type FunctionResult = Record<string, unknown>;

async function call(supabase: SupabaseClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (error.message?.includes("no_business")) throw noBusiness();
    throw error;
  }
  return data;
}

function fieldError(field: string, message: string): ApiError {
  return new ApiError("validation_error", message, { fields: { [field]: message } });
}

/** Turns a refusal reason from a ledger function into an ApiError. */
export function refusal(result: FunctionResult): ApiError {
  const reason = String(result.reason ?? "");
  switch (reason) {
    case "not_found":
      return notFound();
    case "invalid_amount":
      return fieldError("amount", "Enter an amount above 0 with at most two decimals.");
    case "invalid_direction":
      return fieldError("direction", "Choose a direction.");
    case "invalid_date":
      return fieldError("date", "Choose a date from 2000-01-01 up to today.");
    case "invalid_method":
      return fieldError("method", "Only cash payments can be recorded for now.");
    case "note_too_long":
      return fieldError("note", "Use at most 200 characters.");
    case "reference_too_long":
      return fieldError("reference", "Use at most 100 characters.");
    case "reason_required":
      return fieldError("reason", "Write the reason.");
    case "reason_too_long":
      return fieldError("reason", "Use at most 500 characters.");
    case "request_reused":
      return new ApiError("request_reused", "This request was already used for a different entry. Please try again.");
    case "entry_is_reversal":
      return new ApiError("entry_is_reversal", "A reversal cannot be reversed.");
    case "already_reversed":
      return new ApiError("already_reversed", "This entry was already reversed.");
    case "invoice_entry":
      return new ApiError("entry_is_invoice", "An invoice entry is reversed by cancelling the invoice.");
    default:
      return new ApiError("server_error", "Something went wrong. Please try again.");
  }
}

function succeeded<T>(result: FunctionResult): T {
  if (result.done !== true) throw refusal(result);
  return result as unknown as T;
}

/** A function that returns `{ found: false }` when the store does not exist for this business. */
function found<T>(data: unknown): T {
  const record = data as ({ found: boolean } & Record<string, unknown>) | null;
  if (!record || record.found !== true) throw notFound();
  const { found: _found, ...rest } = record;
  void _found;
  return rest as unknown as T;
}

export async function addOpeningBalance(supabase: SupabaseClient, storeId: string, body: OpeningBalanceBody): Promise<EntryResult> {
  return succeeded(
    (await call(supabase, "ledger_opening_add", {
      p_id: body.id,
      p_store_id: storeId,
      p_amount: body.amount,
      p_direction: body.direction,
      p_as_on: body.as_on,
      p_note: body.note,
    })) as FunctionResult,
  );
}

export async function recordPayment(supabase: SupabaseClient, storeId: string, body: PaymentBody): Promise<PaymentResult> {
  return succeeded(
    (await call(supabase, "ledger_payment_add", {
      p_id: body.id,
      p_store_id: storeId,
      p_amount: body.amount,
      p_date: body.date,
      p_method: body.method,
      p_reference: body.reference,
    })) as FunctionResult,
  );
}

export async function addAdjustment(supabase: SupabaseClient, storeId: string, body: AdjustmentBody): Promise<EntryResult> {
  return succeeded(
    (await call(supabase, "ledger_adjustment_add", {
      p_id: body.id,
      p_store_id: storeId,
      p_amount: body.amount,
      p_direction: body.direction,
      p_reason: body.reason,
      p_date: body.date,
    })) as FunctionResult,
  );
}

/** Reverses an entry. The body's id is the id of the new reversal entry (the request id). */
export async function reverseEntry(
  supabase: SupabaseClient,
  storeId: string,
  entryId: string,
  body: ReverseBody,
): Promise<EntryResult & { reversed: unknown }> {
  return succeeded(
    (await call(supabase, "ledger_entry_reverse", {
      p_id: body.id,
      p_entry_id: entryId,
      p_reason: body.reason,
      p_store_id: storeId,
    })) as FunctionResult,
  );
}

export async function listAccounts(supabase: SupabaseClient, query: AccountListQuery): Promise<AccountPage> {
  return (await call(supabase, "ledger_stores", {
    p_q: query.q === "" ? null : query.q,
    p_only_owing: query.only_owing,
    p_limit: query.limit,
    p_offset: query.offset,
  })) as AccountPage;
}

export async function getAccountsSummary(supabase: SupabaseClient): Promise<AccountsSummary> {
  return (await call(supabase, "ledger_summary", {})) as AccountsSummary;
}

export async function getAccount(supabase: SupabaseClient, storeId: string, query: AccountQuery): Promise<AccountView> {
  return found<AccountView>(await call(supabase, "ledger_account", { p_store: storeId, p_limit: query.limit, p_offset: query.offset }));
}

export async function previewPayment(supabase: SupabaseClient, storeId: string, amount: string): Promise<PaymentPreview> {
  return found<PaymentPreview>(await call(supabase, "ledger_payment_preview", { p_store: storeId, p_amount: amount }));
}

export async function getStatement(supabase: SupabaseClient, storeId: string, query: StatementQuery): Promise<Statement> {
  const data = (await call(supabase, "ledger_statement", { p_store: storeId, p_from: query.from, p_to: query.to })) as
    | { found: boolean; valid?: boolean }
    | null;
  if (data && data.found === true && data.valid === false) throw fieldError("from", "The start date must not be after the end date.");
  return found<Statement>(data);
}
