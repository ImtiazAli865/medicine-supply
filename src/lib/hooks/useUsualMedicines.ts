"use client";

import { useCallback } from "react";
import { fetchJson } from "@/lib/api/client";
import type { RepeatPlan, UsualResponse } from "@/lib/orders/fast-types";
import { useApiResource } from "./useApiResource";

/**
 * The store's usual medicines and its repeat source (Module 008). Nothing is fetched without a store.
 * The data lives in the component only; it is never stored on the device.
 */
export function useUsualMedicines(storeId: string | null) {
  const resource = useApiResource<UsualResponse>(storeId ? `/api/orders/usual?store_id=${encodeURIComponent(storeId)}` : null);

  /** The lines to copy from one earlier order (the server checks it belongs to this store). */
  const fetchRepeat = useCallback(
    async (orderId: string): Promise<RepeatPlan> => {
      if (!storeId) throw new Error("Choose a store first.");
      const { data } = await fetchJson<RepeatPlan>(`/api/orders/repeat?store_id=${encodeURIComponent(storeId)}&order_id=${encodeURIComponent(orderId)}`);
      return data;
    },
    [storeId],
  );

  return { usual: resource.data?.usual ?? [], source: resource.data?.source ?? null, loading: resource.loading, error: resource.error, retry: resource.retry, fetchRepeat };
}
