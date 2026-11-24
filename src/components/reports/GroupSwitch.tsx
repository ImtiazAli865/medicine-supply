"use client";

import type { ReportGroup } from "@/lib/reports/types";

const GROUPS: Array<{ id: ReportGroup; label: string }> = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

/** Day, Week or Month for a time series. The same period adds up to the same total in each. */
export function GroupSwitch({ group, onChange }: { group: ReportGroup; onChange: (group: ReportGroup) => void }) {
  return (
    <div role="group" aria-label="Group by" className="flex gap-2" data-testid="report-group">
      {GROUPS.map((g) => (
        <button
          key={g.id}
          type="button"
          aria-pressed={group === g.id}
          onClick={() => onChange(g.id)}
          className={`min-h-11 min-w-11 flex-1 rounded-lg border px-3 py-2 text-base font-medium ${
            group === g.id ? "border-primary bg-primary-soft text-primary-strong" : "border-border bg-surface text-foreground hover:bg-slate-100"
          }`}
        >
          {g.label}
        </button>
      ))}
    </div>
  );
}
