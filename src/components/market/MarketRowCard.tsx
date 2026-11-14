import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { describeProgress, describeRow, statusLabel, statusTone } from "@/lib/market/status";
import type { MarketRow } from "@/lib/market/types";

/**
 * One registered medicine (and unit) of the day: its total, each store's share, and how much is bought. No price
 * or cost is shown here or anywhere on the list. `actions` is the slot for the purchase buttons.
 */
export function MarketRowCard({ row, storeFilterOn, actions }: { row: MarketRow; storeFilterOn: boolean; actions?: ReactNode }) {
  const detail = describeRow(row);
  return (
    <li data-testid="market-row" data-key={row.key} data-status={row.status} className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words text-lg font-semibold" data-testid="market-row-name">
            {row.name}
          </h3>
          {detail ? <p className="text-sm text-muted">{detail}</p> : null}
        </div>
        <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
      </div>

      <p className="text-base" data-testid="market-row-total">
        <span className="font-semibold">Total: {row.total_requested}</span> {row.unit}
      </p>
      <p className="text-sm text-muted" data-testid="market-row-progress">
        {describeProgress(row)}
      </p>

      <ul className="space-y-1 border-t border-border pt-2" aria-label="Quantity by store">
        {row.stores.map((s) => (
          <li key={s.store_id} data-testid="market-store" className="flex justify-between gap-3 text-sm">
            <span className="min-w-0 break-words">{s.store_name}</span>
            <span className="shrink-0 font-medium">{s.quantity}</span>
          </li>
        ))}
      </ul>
      {storeFilterOn && row.shown_requested !== row.total_requested ? (
        <p className="text-sm text-muted">
          Selected stores: {row.shown_requested} of {row.total_requested} {row.unit}
        </p>
      ) : null}

      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </li>
  );
}
