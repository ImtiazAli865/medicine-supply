"use client";

import { useMemo } from "react";
import type { StoreRateMap, StoreRateView } from "@/lib/orders/price";
import type { StoreRatesResponse } from "@/lib/rates/types";
import { useApiResource } from "./useApiResource";

/**
 * The rates of one store (Module 012), keyed by medicine id. Without a network the copy kept on the phone answers
 * (Module 009's local answers). `rates` is null until they are known, so the screen never treats "not loaded" as
 * "this store has no rate".
 */
export function useStoreRates(storeId: string | null) {
  const resource = useApiResource<StoreRatesResponse>(storeId ? `/api/stores/${storeId}/rates` : null);
  const rates: StoreRateMap | null = useMemo(() => {
    if (!resource.data) return null;
    return new Map<string, StoreRateView>(
      resource.data.items.map((r) => [r.product_id, { rate: r.rate, version: r.version, catalog_price_at_set: r.catalog_price_at_set, unit: r.product.unit }]),
    );
  }, [resource.data]);
  return { rates, loading: resource.loading, error: resource.error, retry: resource.retry };
}
