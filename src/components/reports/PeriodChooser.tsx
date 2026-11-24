"use client";

import { useState } from "react";
import { matchPreset, presetRange, validatePeriod, type DayRange, type PeriodPreset } from "@/lib/reports/period";

const PRESETS: Array<{ id: PeriodPreset; label: string }> = [
  { id: "today", label: "Today" },
  { id: "this_week", label: "This week" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
];

/**
 * Presets and a custom start and end date, in Pakistan days. A bad period (end before start, a start in the future,
 * longer than 731 days) is refused here with a clear message and is never sent. Every control is at least 44 px.
 */
export function PeriodChooser({ range, onChange }: { range: DayRange; onChange: (range: DayRange) => void }) {
  // The two dates being typed; the period only changes when both make a valid period.
  const [draft, setDraft] = useState<{ base: string; from: string; to: string }>({ base: `${range.from}|${range.to}`, from: range.from, to: range.to });
  const [message, setMessage] = useState<string | null>(null);
  const base = `${range.from}|${range.to}`;
  const shown = draft.base === base ? draft : { base, from: range.from, to: range.to };
  const active = matchPreset(range);

  function edit(next: { from: string; to: string }) {
    setDraft({ base, ...next });
    const check = validatePeriod(next);
    if (check.ok) {
      setMessage(null);
      onChange(next);
    } else {
      setMessage(check.message);
    }
  }

  return (
    <section aria-label="Period" className="space-y-3" data-testid="report-period">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Quick periods">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={active === p.id}
            onClick={() => {
              setMessage(null);
              onChange(presetRange(p.id));
            }}
            className={`min-h-11 min-w-11 rounded-lg border px-3 py-2 text-base font-medium ${
              active === p.id ? "border-primary bg-primary-soft text-primary-strong" : "border-border bg-surface text-foreground hover:bg-slate-100"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium">
          From
          <input
            type="date"
            value={shown.from}
            onChange={(e) => edit({ from: e.target.value, to: shown.to })}
            className="mt-1 block min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-base"
            data-testid="report-from"
          />
        </label>
        <label className="block text-sm font-medium">
          To
          <input
            type="date"
            value={shown.to}
            onChange={(e) => edit({ from: shown.from, to: e.target.value })}
            className="mt-1 block min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-base"
            data-testid="report-to"
          />
        </label>
      </div>
      {message ? (
        <p role="alert" className="text-sm text-danger" data-testid="report-period-error">
          {message}
        </p>
      ) : null}
    </section>
  );
}
