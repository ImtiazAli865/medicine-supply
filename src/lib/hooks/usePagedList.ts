"use client";

import { useCallback, useEffect, useState } from "react";
import { ClientApiError } from "@/lib/api/client";

interface Loaded<T> {
  key: string;
  items: T[];
  total: number;
  error: string | null;
}

function messageOf(e: unknown): string {
  return e instanceof ClientApiError ? e.message : "Something went wrong. Please try again.";
}

/**
 * A list read by offset with loading, error and retry. The page from the first request replaces the list, later pages
 * are appended. "Loading" means the stored result does not belong to the current request yet.
 * `load` must be a stable function (a module-level function, not one made on each render).
 */
export function usePagedList<T>(urlFor: (offset: number) => string, load: (url: string) => Promise<{ items: T[]; total: number }>) {
  const [attempt, setAttempt] = useState(0);
  const first = urlFor(0);
  const key = `${first}#${attempt}`;
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    load(first)
      .then((page) => {
        if (!cancelled) setLoaded({ key, items: page.items, total: page.total, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoaded({ key, items: [], total: 0, error: messageOf(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [first, key, load]);

  const current = loaded?.key === key ? loaded : null;

  const loadMore = useCallback(async () => {
    if (!current || loadingMore || current.items.length >= current.total) return;
    setLoadingMore(true);
    try {
      const page = await load(urlFor(current.items.length));
      setLoaded((prev) => (prev ? { ...prev, items: [...prev.items, ...page.items], total: page.total, error: null } : prev));
    } catch (e) {
      setLoaded((prev) => (prev ? { ...prev, error: messageOf(e) } : prev));
    } finally {
      setLoadingMore(false);
    }
  }, [current, load, loadingMore, urlFor]);

  return { current, loadingMore, loadMore, retry: () => setAttempt((a) => a + 1) };
}
