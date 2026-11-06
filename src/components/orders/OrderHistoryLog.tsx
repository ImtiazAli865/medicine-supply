import { formatPKR } from "@/lib/money";
import { formatPakistanDateTime } from "@/lib/orders/dates";
import type { OrderEvent } from "@/lib/orders/types";

interface Change {
  type: "quantity" | "unit" | "added" | "removed" | "notes";
  name?: string;
  from?: string | number;
  to?: string | number;
  quantity?: number;
  unit?: string;
  selling_price?: string | null;
}

function describeChange(change: Change): string {
  switch (change.type) {
    case "quantity":
      return `${change.name}: quantity ${change.from} → ${change.to}`;
    case "unit":
      return `${change.name}: unit ${change.from} → ${change.to}`;
    case "added":
      return `Added ${change.name} · ${change.quantity} ${change.unit}${change.selling_price ? ` · ${formatPKR(change.selling_price)}` : " · no selling price"}`;
    case "removed":
      return `Removed ${change.name} · ${change.quantity} ${change.unit}${change.selling_price ? ` · ${formatPKR(change.selling_price)}` : ""}`;
    case "notes":
      return `Notes changed${change.to ? `: "${change.to}"` : " (cleared)"}`;
  }
}

function describeEvent(event: OrderEvent): { title: string; lines: string[] } {
  const detail = event.detail as Record<string, Record<string, unknown> | undefined>;
  switch (event.event_type) {
    case "created":
      return { title: "Order created", lines: [] };
    case "confirmed": {
      const c = detail.confirmed ?? {};
      const unpriced = Number(c.unpriced_lines ?? 0);
      return {
        title: "Order confirmed",
        lines: [`${c.line_count ?? 0} lines · priced total ${formatPKR(String(c.priced_total ?? "0.00"))}${unpriced > 0 ? ` · ${unpriced} without a selling price` : ""}`],
      };
    }
    case "edited": {
      const changes = ((detail.edited?.changes as Change[] | undefined) ?? []).map(describeChange);
      return { title: "Order edited", lines: changes };
    }
    case "cancelled": {
      const c = detail.cancelled ?? {};
      return { title: "Order cancelled", lines: c.reason ? [`Reason: ${String(c.reason)}`] : [] };
    }
  }
}

/** The order's change history, newest first. Purchase price and MRP never appear here. */
export function OrderHistoryLog({ events }: { events: OrderEvent[] }) {
  if (events.length === 0) return null;
  return (
    <section aria-labelledby="history-heading" className="space-y-2" data-testid="order-history-log">
      <h2 id="history-heading" className="text-lg font-semibold">
        Change history
      </h2>
      <ol className="space-y-2">
        {events.map((event) => {
          const { title, lines } = describeEvent(event);
          return (
            <li key={event.id} data-testid="history-event" className="rounded-xl border border-border bg-surface px-4 py-3">
              <p className="font-medium">{title}</p>
              <p className="text-sm text-muted">{formatPakistanDateTime(event.created_at)}</p>
              {lines.length > 0 ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm" dir="auto">
                  {lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
