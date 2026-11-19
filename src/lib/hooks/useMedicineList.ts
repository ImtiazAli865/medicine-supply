"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import { initialListState, listReducer, needsServerSearch, PAGE_SIZE } from "@/lib/orders/fast-list";
import { highlightIndex, parseQuery, runSearch, splitQuantityHint, type QuantityHint } from "@/lib/orders/fast-search";
import type { MedicinePage, SlimMedicine } from "@/lib/orders/fast-types";
import { useDebouncedValue } from "./useDebouncedValue";

function messageOf(error: unknown): string {
  return error instanceof ClientApiError ? error.message : "Something went wrong. Please try again.";
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

interface ServerResult {
  key: string;
  items: SlimMedicine[];
  more: boolean;
  hint: QuantityHint | null;
  error: string | null;
}

async function searchServer(text: string, signal: AbortSignal): Promise<MedicinePage> {
  const { data } = await fetchJson<MedicinePage>(`/api/orders/medicines?${new URLSearchParams({ q: text, limit: "30" })}`, { signal });
  return data;
}

/** The server search used while the list loads, after a load error, and when the catalog is too large for the device. */
function useServerSearch(query: string, enabled: boolean) {
  const debounced = useDebouncedValue(query.trim(), 150);
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<ServerResult | null>(null);
  const active = enabled && debounced !== "";
  const key = `${debounced}#${reloadKey}`;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    (async () => {
      try {
        let page = await searchServer(debounced, controller.signal);
        let hint: QuantityHint | null = null;
        if (page.items.length === 0) {
          // Nothing matches the whole text: a trailing "x20" is a quantity, so search the text without it.
          const split = splitQuantityHint(debounced);
          if (split) {
            page = await searchServer(split.base, controller.signal);
            hint = split.hint;
          }
        }
        setResult({ key, items: page.items, more: page.next_cursor !== null, hint, error: null });
      } catch (e) {
        if (isAbort(e)) return;
        // Keep the previous results on screen and remember the error for this request.
        setResult((prev) => ({ key, items: prev?.items ?? [], more: false, hint: prev?.hint ?? null, error: messageOf(e) }));
      }
    })();
    return () => controller.abort();
  }, [active, debounced, key]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  return {
    items: result?.items ?? [],
    more: result?.more ?? false,
    hint: result?.hint ?? null,
    loading: active && result?.key !== key,
    error: active && result?.key === key ? result.error : null,
    retry,
  };
}

/**
 * The medicine search of the order screen (Module 008). When the screen opens the active medicines are loaded page by
 * page and then searched on the device; the list lives in this component only (never in browser storage) and is
 * reloaded whenever the screen opens again and on `refresh`. While it loads, after a load error, or when the catalog is
 * too large, typing is answered by the server search instead. Previous results stay on screen while a new search loads.
 */
export function useMedicineList(query: string) {
  const [loadNumber, setLoadNumber] = useState(1);
  const latestLoad = useRef(1);
  const [state, dispatch] = useReducer(listReducer, 1, initialListState);

  useEffect(() => {
    const controller = new AbortController();
    const loadId = loadNumber;
    (async () => {
      let cursor: string | null = null;
      try {
        do {
          const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
          if (cursor) params.set("cursor", cursor);
          const { data } = await fetchJson<MedicinePage>(`/api/orders/medicines?${params}`, { signal: controller.signal });
          dispatch({ type: "page", loadId, items: data.items, next: data.next_cursor });
          cursor = data.next_cursor;
        } while (cursor);
      } catch (e) {
        if (!isAbort(e)) dispatch({ type: "fail", loadId, message: messageOf(e) });
      }
    })();
    return () => controller.abort();
  }, [loadNumber]);

  /** Loads the list again (the "Refresh medicines" button and Retry after a load error). */
  const refresh = useCallback(() => {
    latestLoad.current += 1;
    dispatch({ type: "start", loadId: latestLoad.current });
    setLoadNumber(latestLoad.current);
  }, []);

  const useServer = needsServerSearch(state);
  const server = useServerSearch(query, useServer);
  const hasWords = useMemo(() => parseQuery(query).words.length > 0, [query]);
  const local = useMemo(() => (useServer ? null : runSearch(state.rows, query)), [useServer, state.rows, query]);

  const results = local ? local.results : hasWords ? server.items : [];
  const more = local ? local.more > 0 : server.more;
  const hint = local ? local.hint : hasWords ? server.hint : null;
  return {
    status: state.status,
    loaded: state.rows.length,
    listError: state.status === "error" ? state.error : null,
    results,
    more,
    /** The quantity read from a trailing "x20", or null. It never chooses a result. */
    hint,
    /** The index Enter may choose without a tap (only when exactly one medicine is left), or null. */
    highlight: highlightIndex(results, more ? 1 : 0),
    /** True while the server search for the current text is on its way (the previous results stay visible). */
    searching: server.loading,
    searchError: server.error,
    retrySearch: server.retry,
    refresh,
    /** The catalog has no active medicine at all (known only once the list is complete). */
    catalogEmpty: state.status === "ready" && state.rows.length === 0,
    source: local ? ("device" as const) : ("server" as const),
  };
}
