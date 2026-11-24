import type { ReactNode } from "react";

export interface BarRow {
  key: string;
  label: string;
  /** The amount as the server sent it; used only to size the bar. Every value is also written as text by the row. */
  amount: string;
  /** The text of the row (amounts and counts as words). */
  detail: ReactNode;
}

/**
 * Rows with a simple bar behind each label, drawn with plain CSS (no chart package). The bar length is a picture
 * only: it is `aria-hidden`, and the amounts are always written as text. No money is added up here.
 */
export function BarList({ rows, testId }: { rows: BarRow[]; testId?: string }) {
  const largest = Math.max(0, ...rows.map((r) => Math.abs(Number(r.amount)) || 0));
  return (
    <ul className="space-y-2" data-testid={testId}>
      {rows.map((row) => {
        const width = largest > 0 ? Math.max(2, Math.round((Math.abs(Number(row.amount)) / largest) * 100)) : 0;
        return (
          <li key={row.key} className="rounded-xl border border-border bg-surface p-3" data-testid="report-row">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="font-medium">{row.label}</p>
            </div>
            <div aria-hidden="true" className="my-2 h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-primary" style={{ width: `${width}%` }} />
            </div>
            <div className="text-sm">{row.detail}</div>
          </li>
        );
      })}
    </ul>
  );
}
