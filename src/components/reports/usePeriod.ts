"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { rangeOrDefault, type DayRange } from "@/lib/reports/period";
import type { ReportGroup } from "@/lib/reports/types";

export interface PeriodApi {
  range: DayRange;
  group: ReportGroup;
  q: string;
  sort: string;
  offset: number;
  setRange: (range: DayRange) => void;
  setGroup: (group: ReportGroup) => void;
  setQuery: (q: string) => void;
  setSort: (sort: string) => void;
  setOffset: (offset: number) => void;
}

/**
 * The period, the grouping, the search and the sort of a report screen live in the address, so Back and a refresh keep
 * them. A missing or bad value falls back to this month, by day, newest first (never an error screen).
 */
export function usePeriod(): PeriodApi {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const range = useMemo(() => rangeOrDefault({ from: params.get("from"), to: params.get("to") }), [params]);
  const groupText = params.get("group");
  const group: ReportGroup = groupText === "week" || groupText === "month" ? groupText : "day";
  const q = (params.get("q") ?? "").slice(0, 100);
  const sortText = params.get("sort");
  const sort = sortText === "profit" || sortText === "name" ? sortText : "sales";
  const offsetNumber = Number.parseInt(params.get("offset") ?? "0", 10);
  const offset = Number.isInteger(offsetNumber) && offsetNumber > 0 ? offsetNumber : 0;

  const write = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      // Any change other than moving between pages starts again at the first page.
      if (!("offset" in changes)) next.delete("offset");
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const text = next.toString();
      router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return {
    range,
    group,
    q,
    sort,
    offset,
    setRange: (r) => write({ from: r.from, to: r.to }),
    setGroup: (g) => write({ group: g === "day" ? null : g }),
    setQuery: (value) => write({ q: value.trim() === "" ? null : value }),
    setSort: (value) => write({ sort: value === "sales" ? null : value }),
    setOffset: (value) => write({ offset: value > 0 ? String(value) : null }),
  };
}
