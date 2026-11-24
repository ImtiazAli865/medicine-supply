"use client";

import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { PeriodApi } from "./usePeriod";

const SORTS: Array<{ id: string; label: string }> = [
  { id: "sales", label: "Sales" },
  { id: "profit", label: "Realized profit" },
  { id: "name", label: "Name" },
];

/**
 * A search box (applied after a short pause) and the sort choices of a list report. They stay on the screen in every
 * state, so a search with no match can be cleared. "Realized profit" puts the rows whose profit is not available last.
 */
export function ListControls({ period, searchLabel }: { period: PeriodApi; searchLabel: string }) {
  const { q, sort, setQuery, setSort } = period;
  const [text, setText] = useState(q);
  const [seen, setSeen] = useState(q);
  if (seen !== q) {
    // The address changed (Back, a preset): show what the address says.
    setSeen(q);
    setText(q);
  }

  useEffect(() => {
    if (text === q) return;
    const timer = setTimeout(() => setQuery(text), 350);
    return () => clearTimeout(timer);
  }, [text, q, setQuery]);

  return (
    <section aria-label="Search and sort" className="space-y-3">
      <label className="block text-sm font-medium">
        {searchLabel}
        <span className="relative mt-1 block">
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={100}
            className="block min-h-11 w-full rounded-lg border border-border bg-surface pl-10 pr-3 text-base"
            data-testid="report-search"
          />
        </span>
      </label>
      <div role="group" aria-label="Sort by" className="flex flex-wrap gap-2" data-testid="report-sort">
        {SORTS.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={sort === s.id}
            onClick={() => setSort(s.id)}
            className={`min-h-11 min-w-11 rounded-lg border px-3 py-2 text-base font-medium ${
              sort === s.id ? "border-primary bg-primary-soft text-primary-strong" : "border-border bg-surface text-foreground hover:bg-slate-100"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {sort === "profit" ? <p className="text-sm text-muted">Rows whose realized profit is not available are listed last.</p> : null}
    </section>
  );
}
