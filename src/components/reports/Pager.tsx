"use client";

/** "Rows 21 to 40 of 57" with Previous and Next. Moves one page at a time; the address keeps the page. */
export function Pager({ offset, pageSize, shown, total, onOffset }: { offset: number; pageSize: number; shown: number; total: number; onOffset: (offset: number) => void }) {
  if (total <= pageSize) return null;
  const first = shown === 0 ? 0 : offset + 1;
  const last = offset + shown;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3" data-testid="report-pager">
      <button
        type="button"
        disabled={offset === 0}
        onClick={() => onOffset(Math.max(0, offset - pageSize))}
        className="min-h-11 min-w-11 rounded-lg border border-border bg-surface px-4 py-2 text-base font-medium disabled:opacity-50"
      >
        Previous
      </button>
      <p className="text-sm text-muted" data-testid="report-pager-text">
        Rows {first} to {last} of {total}
      </p>
      <button
        type="button"
        disabled={last >= total}
        onClick={() => onOffset(offset + pageSize)}
        className="min-h-11 min-w-11 rounded-lg border border-border bg-surface px-4 py-2 text-base font-medium disabled:opacity-50"
      >
        Next
      </button>
    </nav>
  );
}
