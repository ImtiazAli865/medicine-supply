"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import { useDebouncedValue } from "./useDebouncedValue";

interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export type StatusFilter = "active" | "inactive" | "all";

interface Result<T> {
  /** The request key these items belong to. */
  key: string;
  items: T[];
  next: string | null;
  error: string | null;
}

function messageOf(e: unknown): string {
  return e instanceof ClientApiError ? e.message : "Something went wrong. Please try again.";
}

/**
 * Debounced search + paging against a list endpoint. Previous results stay on screen while a new
 * search is loading, so typing never flashes unrelated or empty results. "Loading" simply means
 * the stored result does not belong to the current request key yet.
 */
export function useSearchList<T>(endpoint: string, query: string, status: StatusFilter) {
  const debounced = useDebouncedValue(query, 250);
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<Result<T> | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const buildUrl = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ status, limit: "50" });
      if (debounced.trim()) params.set("q", debounced.trim());
      if (cursor) params.set("cursor", cursor);
      return `${endpoint}?${params.toString()}`;
    },
    [endpoint, debounced, status],
  );

  const key = useMemo(() => `${buildUrl()}#${reloadKey}`, [buildUrl, reloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    fetchJson<Page<T>>(buildUrl(), { signal: controller.signal })
      .then(({ data }) => setResult({ key, items: data.items, next: data.next_cursor, error: null }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        // Keep whatever was on screen, but remember the error for this request.
        setResult((prev) => ({ key, items: prev?.items ?? [], next: null, error: messageOf(e) }));
      });
    return () => controller.abort();
  }, [buildUrl, key]);

  const loadMore = useCallback(async () => {
    const next = result?.next;
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const { data } = await fetchJson<Page<T>>(buildUrl(next));
      setResult((prev) => (prev ? { ...prev, items: [...prev.items, ...data.items], next: data.next_cursor } : prev));
    } catch (e) {
      setResult((prev) => (prev ? { ...prev, error: messageOf(e) } : prev));
    } finally {
      setLoadingMore(false);
    }
  }, [buildUrl, result, loadingMore]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  return {
    items: result?.items ?? [],
    loading: result?.key !== key,
    loadingMore,
    error: result && result.key === key ? result.error : null,
    hasMore: result?.next != null,
    loadMore,
    retry,
    searching: query.trim() !== debounced.trim(),
    activeQuery: debounced.trim(),
  };
}
