"use client";

import { useEffect, useState } from "react";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import { OFFLINE_MESSAGE } from "./labels";

// Reading a report from a screen. A report is never answered from the phone: when the network fails the screen says
// "Reports need the internet" and shows no old numbers, and a failed load is an error with Retry, never a zero.

/** The address of a report route with the given query values (empty values are left out). */
export function reportUrl(path: string, params: Record<string, string | number | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

interface Stored<T> {
  key: string;
  data?: T;
  error?: string;
  offline?: boolean;
}

export interface ReportResource<T> {
  data: T | undefined;
  error: string | undefined;
  offline: boolean;
  loading: boolean;
  retry: () => void;
}

/** GET one report with loading, error (with `offline` when the network failed) and retry. Pass null to skip. */
export function useReport<T>(url: string | null): ReportResource<T> {
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
        if (e instanceof ClientApiError && e.code === "network") setStored({ key, error: OFFLINE_MESSAGE, offline: true });
        else setStored({ key, error: e instanceof ClientApiError ? e.message : "Something went wrong. Please try again.", offline: false });
      });
    return () => {
      cancelled = true;
    };
  }, [key, url]);

  const loading = key !== null && stored?.key !== key;
  return {
    data: !loading ? stored?.data : undefined,
    error: !loading ? stored?.error : undefined,
    offline: !loading && stored?.offline === true,
    loading,
    retry: () => setAttempt((a) => a + 1),
  };
}
