import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, noBusiness } from "@/lib/api/errors";
import type { CostMissingReport, MedicineReport, NotInAccount, PurchaseReport, ReportGroup, SalesReport, StoreReport } from "./types";

// The Module 010 reports run only through read-only database functions (migration 0011). The functions read the
// business from the signed-in user's session, so Row Level Security and the explicit business filters both apply.
// A refusal from the database becomes the documented ApiError here, so every screen shows the same wording.

async function call(supabase: SupabaseClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw translate(error);
  return data;
}

/** A database error as the error the API documents. Anything unknown is passed on and becomes a server error. */
export function translate(error: { message?: string; code?: string }): unknown {
  const message = error.message ?? "";
  if (message.includes("no_business")) return noBusiness();
  if (message.includes("invalid_period")) {
    const detail = message.split("invalid_period:")[1]?.trim() ?? "Please check the period.";
    const text = detail.charAt(0).toUpperCase() + detail.slice(1) + (detail.endsWith(".") ? "" : ".");
    return new ApiError("validation_error", text, { fields: { to: text } });
  }
  return error;
}

export async function getSalesReport(supabase: SupabaseClient, q: { from: string; to: string; group: ReportGroup }): Promise<SalesReport> {
  return (await call(supabase, "report_sales", { p_from: q.from, p_to: q.to, p_group: q.group })) as SalesReport;
}

export async function getCostMissing(supabase: SupabaseClient, q: { from: string; to: string }): Promise<CostMissingReport> {
  return (await call(supabase, "report_cost_missing", { p_from: q.from, p_to: q.to })) as CostMissingReport;
}

export async function getPurchaseReport(supabase: SupabaseClient, q: { from: string; to: string; group: ReportGroup }): Promise<PurchaseReport> {
  return (await call(supabase, "report_purchases", { p_from: q.from, p_to: q.to, p_group: q.group })) as PurchaseReport;
}

export interface ListArgs {
  from: string;
  to: string;
  q: string;
  sort: string;
  limit: number;
  offset: number;
}

function listArgs(q: ListArgs) {
  return { p_from: q.from, p_to: q.to, p_q: q.q === "" ? null : q.q, p_sort: q.sort, p_limit: q.limit, p_offset: q.offset };
}

export async function getStoreReport(supabase: SupabaseClient, q: ListArgs): Promise<StoreReport> {
  return (await call(supabase, "report_by_store", listArgs(q))) as StoreReport;
}

export async function getMedicineReport(supabase: SupabaseClient, q: ListArgs): Promise<MedicineReport> {
  return (await call(supabase, "report_by_medicine", listArgs(q))) as MedicineReport;
}

export async function getNotInAccount(supabase: SupabaseClient): Promise<NotInAccount> {
  return (await call(supabase, "report_not_in_account", {})) as NotInAccount;
}
