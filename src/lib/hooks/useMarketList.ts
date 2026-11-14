"use client";

import { useCallback, useEffect, useState } from "react";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import { marketListUrl, type ListParams } from "@/lib/market/client";
import type { MarketList } from "@/lib/market/types";

interface Settled {
  key: string;
  data?: MarketList;
  error?: string;
}

/**
 * Loads the market list for the given parameters. While a new request is running, the last list of the SAME day
 * stays on screen (so recording a purchase does not blank the screen); a list of another day is never shown
 * under a new date. The list is fetched when the parameters change, on `refresh()`, and when the page becomes
 * visible again after being hidden, so stale totals are never presented as final without a way to refresh.
 */
export function useMarketList(params: ListParams) {
  const url = marketListUrl(params);
  const [attempt, setAttempt] = useState(0);
  const key = `${url}#${attempt}`;
  const [settled, setSettled] = useState<Settled | null>(null);
  const [last, setLast] = useState<{ data: MarketList; at: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<MarketList>(url)
      .then(({ data }) => {
        if (cancelled) return;
        setSettled({ key, data });
        setLast({ data, at: new Date().toISOString() });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSettled({ key, error: error instanceof ClientApiError ? error.message : "Something went wrong. Please try again." });
      });
    return () => {
      cancelled = true;
    };
  }, [key, url]);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const loading = settled?.key !== key;
  const sameDay = last?.data.date === params.date;
  return {
    data: loading ? (sameDay ? last?.data : undefined) : settled?.data,
    error: loading ? undefined : settled?.error,
    loading,
    updating: loading && Boolean(sameDay),
    updatedAt: last?.at ?? null,
    refresh,
  };
}
