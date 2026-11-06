import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { ApiError, noBusiness } from "@/lib/api/errors";
import type { SettingsUpdate } from "@/lib/validation/settings";
import type { Settings } from "./types";

const SETTINGS_COLUMNS = "phone,address,thermal_paper_mm,account_summary_default,details_saved,checklist_dismissed,version";

/** Defaults shown for a business whose settings row is missing (it is created on the first save). */
const DEFAULTS = {
  phone: null,
  address: null,
  thermal_paper_mm: 80,
  account_summary_default: false,
  details_saved: false,
  checklist_dismissed: false,
  version: 1,
} as const;

export async function getSettings(supabase: SupabaseClient): Promise<Settings> {
  // Row Level Security limits both reads to the caller's own business.
  const [settings, business] = await Promise.all([
    supabase.from("business_settings").select(SETTINGS_COLUMNS).maybeSingle(),
    supabase.from("businesses").select("name").maybeSingle(),
  ]);
  if (settings.error) throw settings.error;
  if (business.error) throw business.error;
  if (!business.data) throw noBusiness();
  return { name: business.data.name as string, ...(settings.data ?? DEFAULTS) } as Settings;
}

function mapError(error: PostgrestError): never {
  if (error.message?.includes("no_business")) throw noBusiness();
  if (error.code === "23514") {
    throw new ApiError("validation_error", "Please correct the highlighted fields.");
  }
  throw error;
}

export async function saveSettings(supabase: SupabaseClient, input: SettingsUpdate): Promise<Settings> {
  const { data, error } = await supabase.rpc("save_business_settings", {
    p_expected_version: input.expected_version,
    p_name: input.name,
    p_phone: input.phone,
    p_address: input.address,
    p_thermal_paper_mm: input.thermal_paper_mm,
    p_account_summary_default: input.account_summary_default,
  });
  if (error) mapError(error);

  const body = data as { saved: boolean; settings?: Settings; current?: Settings };
  if (!body.saved) {
    throw new ApiError("version_conflict", "The settings were changed elsewhere. Review the latest values, then save again.", {
      current: body.current,
    });
  }
  return body.settings as Settings;
}
