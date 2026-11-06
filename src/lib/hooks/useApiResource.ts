"use client";

import { useEffect, useState } from "react";
import { ClientApiError, fetchJson } from "@/lib/api/client";

interface Stored<T> {
  key: string;
  data?: T;
  error?: string;
}

/**
 * GET one JSON resource with loading, error and retry. "Loading" simply means the stored result does
 * not belong to the current request key yet, so there is no synchronous state change inside the effect.
 * Pass null to skip the request.
 */
export function useApiResource<T>(url: string | null) {
  const [attempt, setAttempt] = useState(0);
  const key = url === null ? null : `${url}#${attempt}`;
  const [stored, setStored] = useState<Stored<T> | null>(null);

  useEffect(() => {
    if (key === null || url === null) return;
    let cancelled = false;
    fetchJson<T>(url)
      .then(({ data }) => {
        if (!cancelled) setStored({ key, data });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setStored({ key, error: e instanceof ClientApiError ? e.message : "Something went wrong. Please try again." });
      });
    return () => {
      cancelled = true;
    };
  }, [key, url]);

  const loading = key !== null && stored?.key !== key;
  return {
    data: !loading ? stored?.data : undefined,
    error: !loading ? stored?.error : undefined,
    loading,
    retry: () => setAttempt((a) => a + 1),
  };
}
