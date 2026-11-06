import type { SupabaseClient } from "@supabase/supabase-js";
import type { SetupState } from "@/lib/settings/types";

async function exists(supabase: SupabaseClient, table: "stores" | "products"): Promise<boolean> {
  const { data, error } = await supabase.from(table).select("id").limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Checklist state derived from real data: it can never be stale and survives work done in any order.
 * Only "details saved" and "dismissed" are stored (on the settings row).
 */
export async function getSetupState(supabase: SupabaseClient): Promise<SetupState> {
  const [settings, stores, products] = await Promise.all([
    supabase.from("business_settings").select("details_saved,checklist_dismissed").maybeSingle(),
    exists(supabase, "stores"),
    exists(supabase, "products"),
  ]);
  if (settings.error) throw settings.error;
  return {
    details_done: Boolean(settings.data?.details_saved),
    stores_done: stores,
    catalog_done: products,
    dismissed: Boolean(settings.data?.checklist_dismissed),
  };
}

/** Dismiss or show the checklist. Only that one column can be written directly (column privilege). */
export async function setChecklistDismissed(supabase: SupabaseClient, businessId: string, dismissed: boolean): Promise<SetupState> {
  const { error } = await supabase.from("business_settings").update({ checklist_dismissed: dismissed }).eq("business_id", businessId);
  if (error) throw error;
  return getSetupState(supabase);
}
