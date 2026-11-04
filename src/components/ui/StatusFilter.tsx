"use client";

import type { StatusFilter } from "@/lib/hooks/useSearchList";

const OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "all", label: "All" },
];

export function StatusFilterControl({ value, onChange }: { value: StatusFilter; onChange: (v: StatusFilter) => void }) {
  return (
    <div role="group" aria-label="Show" className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface p-1">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`min-h-11 rounded-md text-base font-medium ${
            value === opt.value ? "bg-primary text-white" : "text-muted hover:bg-slate-100"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
