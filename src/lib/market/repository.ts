import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, noBusiness, notFound } from "@/lib/api/errors";
import type { ListQuery, PurchaseQuery, RecordPurchaseBody, VoidPurchaseBody } from "@/lib/validation/market";
import type { MarketList, MarketSummary, PurchaseEntries, PurchaseResult } from "./types";

// The market list and purchase recording run only through database functions (migration 0006). The functions
// read the business from the signed-in user's session. A refusal comes back as a `reason` that is turned into
// the documented ApiError here, so every screen shows the same wording.

type FunctionResult = Record<string, unknown>;

async function call(supabase: SupabaseClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (error.message?.includes("no_business")) throw noBusiness();
    throw error;
  }
  return data;
}

/** The most rows one list returns (the same cap as the database function). */
export const LIST_ROW_CAP = 2000;

/** Turns a refusal reason from a purchase function into an ApiError. */
export function refusal(result: FunctionResult): ApiError {
  const reason = String(result.reason ?? "");
  switch (reason) {
    case "invalid_purchase":
    case "invalid_void": {
      const fields = (result.fields ?? {}) as Record<string, string>;
      return new ApiError("validation_error", Object.values(fields)[0] ?? "Please check the purchase.", { fields });
    }
    case "product_not_found":
    case "not_found":
      return notFound();
    case "request_reused":
      return new ApiError("request_reused", "This request was already used for a different purchase. Please try again.");
    default:
      return new ApiError("server_error", "Something went wrong. Please try again.");
  }
}

function listArgs(query: Pick<ListQuery, "date" | "q" | "status" | "stores">) {
  return {
    p_date: query.date,
    p_q: query.q === "" ? null : query.q,
    p_status: query.status,
    p_stores: query.stores.length > 0 ? query.stores : null,
  };
}

/** The market list of one Pakistan day. When it has more rows than the cap, `truncated` is true. */
export async function getMarketList(supabase: SupabaseClient, query: Pick<ListQuery, "date" | "q" | "status" | "stores">): Promise<MarketList> {
  return (await call(supabase, "market_list", listArgs(query))) as MarketList;
}

/** The same list for the print page and the CSV, which must never be cut short. */
export async function getCompleteMarketList(supabase: SupabaseClient, query: Pick<ListQuery, "date" | "q" | "status" | "stores">): Promise<MarketList> {
  const list = await getMarketList(supabase, query);
  if (list.truncated) {
    throw new ApiError("list_too_large", "Too many rows to export. Narrow the list with a store or a search.");
  }
  return list;
}

export async function getMarketSummary(supabase: SupabaseClient, date: string): Promise<MarketSummary> {
  return (await call(supabase, "market_summary", { p_date: date })) as MarketSummary;
}

/** The purchase entries of one medicine, unit and date, cancelled ones included. */
export async function listPurchases(supabase: SupabaseClient, query: PurchaseQuery): Promise<PurchaseEntries> {
  const data = (await call(supabase, "purchase_entries_list", {
    p_product: query.product,
    p_unit: query.unit,
    p_date: query.date,
  })) as (PurchaseEntries & { found: boolean }) | { found: false };
  if (!data.found) throw notFound();
  const { entries, purchased, requested } = data as PurchaseEntries;
  return { entries, purchased, requested };
}

export async function recordPurchase(supabase: SupabaseClient, body: RecordPurchaseBody): Promise<PurchaseResult> {
  const result = (await call(supabase, "purchase_record", {
    p_id: body.id,
    p_product: body.product_id,
    p_unit: body.unit,
    p_date: body.purchase_date,
    p_quantity: body.quantity,
    p_unit_cost: body.unit_cost,
    p_supplier: body.supplier_name,
    p_reference: body.reference,
  })) as FunctionResult;
  if (result.done !== true) throw refusal(result);
  return result as unknown as PurchaseResult;
}

export async function voidPurchase(supabase: SupabaseClient, entryId: string, body: VoidPurchaseBody): Promise<PurchaseResult> {
  const result = (await call(supabase, "purchase_void", { p_entry: entryId, p_reason: body.reason })) as FunctionResult;
  if (result.done !== true) throw refusal(result);
  return result as unknown as PurchaseResult;
}
