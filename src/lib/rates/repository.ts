import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, notFound } from "@/lib/api/errors";
import { decodeCursor, slicePage } from "@/lib/api/paging";
import type { DeviceRate, DeviceRatePage, StoreRate, StoreRatesResponse } from "./types";

// Rates are read and written only through the database functions of migration 0012, as the signed-in user.

async function call(supabase: SupabaseClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

export async function listStoreRates(supabase: SupabaseClient, storeId: string): Promise<StoreRatesResponse> {
  const data = (await call(supabase, "store_rates_list", { p_store: storeId })) as StoreRate[] | null;
  if (data === null) throw notFound();
  return { items: data };
}

export async function listAllRates(supabase: SupabaseClient, limit: number, cursor: string | undefined): Promise<DeviceRatePage> {
  const offset = decodeCursor(cursor);
  const data = (await call(supabase, "store_rates_all", { p_limit: limit + 1, p_offset: offset })) as DeviceRate[] | null;
  return slicePage(data ?? [], offset, limit);
}

type RateAnswer = { done: boolean; reason?: string; rate?: StoreRate; current?: StoreRate | null };

function refusal(result: RateAnswer): ApiError {
  switch (result.reason) {
    case "not_found":
      return notFound();
    case "invalid_rate":
      return new ApiError("validation_error", "Enter a price above 0 with at most two decimals.", {
        fields: { rate: "Enter a price above 0 with at most two decimals." },
      });
    case "version_conflict":
      return new ApiError("version_conflict", "This rate was changed elsewhere.", { current: result.current ?? null });
    default:
      return new ApiError("server_error", "Something went wrong. Please try again.");
  }
}

export async function setStoreRate(supabase: SupabaseClient, storeId: string, productId: string, rate: string, expectedVersion: number | null): Promise<StoreRate> {
  const data = (await call(supabase, "store_rate_set", {
    p_store: storeId,
    p_product: productId,
    p_rate: rate,
    p_expected_version: expectedVersion,
  })) as RateAnswer;
  if (!data.done || !data.rate) throw refusal(data);
  return data.rate;
}

export async function removeStoreRate(supabase: SupabaseClient, storeId: string, productId: string, expectedVersion: number): Promise<{ removed: true }> {
  const data = (await call(supabase, "store_rate_remove", { p_store: storeId, p_product: productId, p_expected_version: expectedVersion })) as RateAnswer;
  if (!data.done) throw refusal(data);
  return { removed: true };
}
