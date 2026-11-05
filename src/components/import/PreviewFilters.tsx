"use client";

import type { RowStatus, StatusCounts } from "@/lib/import/types";
import { STATUS_LABEL, STATUS_ORDER } from "./status";

export type PreviewFilter = "all" | RowStatus;

export function PreviewFilters({
  counts,
  total,
  value,
  onChange,
}: {
  counts: StatusCounts;
  total: number;
  value: PreviewFilter;
  onChange: (v: PreviewFilter) => void;
}) {
  const chips: { value: PreviewFilter; label: string; count: number }[] = [
    { value: "all", label: "All", count: total },
    ...STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => ({ value: s as PreviewFilter, label: STATUS_LABEL[s], count: counts[s] })),
  ];
  return (
    <div role="group" aria-label="Filter rows by status" className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <button
          key={c.value}
          type="button"
          aria-pressed={value === c.value}
          data-testid={`filter-${c.value}`}
          onClick={() => onChange(c.value)}
          className={`min-h-11 rounded-full border px-4 text-base font-medium ${
            value === c.value ? "border-primary bg-primary text-white" : "border-border bg-surface text-foreground hover:bg-slate-100"
          }`}
        >
          {c.label} <span className="tabular-nums">({c.count.toLocaleString("en-US")})</span>
        </button>
      ))}
    </div>
  );
}
