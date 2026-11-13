import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import type { MarketRow } from "@/lib/market/types";

/**
 * The group "Not yet registered": typed medicines that are on confirmed orders but have no medicine yet, grouped by
 * the exact typed text, so no requested quantity is ever left out. They cannot be bought until they are registered
 * or linked (Module 004); `actions` is the slot for the "Register this medicine" link.
 */
export function UnregisteredGroup({ rows, actions }: { rows: MarketRow[]; actions?: (row: MarketRow) => ReactNode }) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="unregistered-heading" className="space-y-3" data-testid="unregistered-group">
      <div>
        <h2 id="unregistered-heading" className="text-lg font-semibold">
          Not yet registered
        </h2>
        <p className="text-sm text-muted">These medicines were typed on orders and are not registered yet. Register or link them to buy them.</p>
      </div>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.key} data-testid="market-typed-row" data-key={row.key} className="space-y-3 rounded-xl border border-warning/40 bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="min-w-0 break-words text-lg font-semibold" data-testid="market-row-name">
                {row.typed_name}
              </h3>
              <Badge tone="warning">unregistered</Badge>
            </div>
            <p className="text-base" data-testid="market-row-total">
              <span className="font-semibold">Total: {row.total_requested}</span> {row.unit}
            </p>
            <ul className="space-y-1 border-t border-border pt-2" aria-label="Quantity by store">
              {row.stores.map((s) => (
                <li key={s.store_id} data-testid="market-store" className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0 break-words">{s.store_name}</span>
                  <span className="shrink-0 font-medium">{s.quantity}</span>
                </li>
              ))}
            </ul>
            {actions ? <div className="flex flex-wrap gap-2">{actions(row)}</div> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
