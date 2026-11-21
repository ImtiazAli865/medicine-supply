import { formatPKR } from "@/lib/money";
import { orderTotals, totalsLabel, type PricedLine } from "@/lib/orders/totals";

/**
 * The order total. It says "Total of priced lines" and counts the lines without a selling price whenever
 * there are any, so a partial total is never presented as complete.
 */
export function OrderTotals({ lines, lastKnown = false }: { lines: PricedLine[]; /** The prices come from the copy on this phone (offline). */ lastKnown?: boolean }) {
  const totals = orderTotals(lines);
  const label = totalsLabel(totals);
  if (totals.lineCount === 0) return null;
  return (
    <div data-testid="order-totals" className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium">{label.heading}</p>
        <p data-testid="order-total-amount" className="text-xl font-semibold">
          {label.hasAnyPrice ? formatPKR(totals.pricedTotal) : "—"}
        </p>
      </div>
      {lastKnown ? (
        <p data-testid="order-total-last-known" className="mt-1 text-sm text-muted">
          These are the last known prices on this phone. The final prices are fixed when you confirm the order online.
        </p>
      ) : null}
      {label.note ? (
        <p data-testid="order-total-note" className="mt-1 text-sm text-warning">
          {label.note}
        </p>
      ) : null}
    </div>
  );
}
