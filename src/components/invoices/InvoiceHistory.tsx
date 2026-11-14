import { formatPakistanDateTime } from "@/lib/orders/dates";
import { formatInvoiceMoney } from "@/lib/invoices/status";
import type { InvoiceEvent } from "@/lib/invoices/types";

interface Change {
  name?: string;
  old?: number;
  new?: number;
}

function describe(event: InvoiceEvent): { title: string; lines: string[] } {
  const detail = event.detail as Record<string, Record<string, unknown> | undefined>;
  switch (event.event_type) {
    case "created":
      return { title: "Draft created", lines: [`${detail.created?.line_count ?? 0} lines copied from the order`] };
    case "edited": {
      const changes = (detail.edited?.changes as Change[] | undefined) ?? [];
      return { title: "Delivered quantities changed", lines: changes.map((c) => `${c.name ?? "Line"}: ${c.old ?? "?"} → ${c.new ?? "?"}`) };
    }
    case "refreshed":
      return { title: "Draft refreshed from the order", lines: [`${detail.refreshed?.line_count ?? 0} lines rebuilt`] };
    case "issued": {
      const issued = detail.issued ?? {};
      return {
        title: `Invoice ${String(issued.number_label ?? "")} issued`.trim(),
        lines: [`Total ${formatInvoiceMoney(typeof issued.grand_total === "string" ? issued.grand_total : null)} · ${issued.billed_lines ?? 0} billed lines`],
      };
    }
    case "cancelled": {
      const cancelled = detail.cancelled ?? {};
      return { title: `Invoice ${String(cancelled.number_label ?? "")} cancelled`.trim(), lines: cancelled.reason ? [`Reason: ${String(cancelled.reason)}`] : [] };
    }
    case "discarded":
      return { title: "Draft discarded", lines: [] };
    default:
      return { title: "Invoice updated", lines: [] };
  }
}

/** The invoice change history, newest first. It never shows a purchase price, MRP or cost: none is stored. */
export function InvoiceHistory({ events }: { events: InvoiceEvent[] }) {
  if (events.length === 0) return null;
  return (
    <section aria-labelledby="invoice-history-heading" className="space-y-2" data-testid="invoice-history">
      <h2 id="invoice-history-heading" className="text-lg font-semibold">
        Change history
      </h2>
      <ol className="space-y-2">
        {events.map((event) => {
          const { title, lines } = describe(event);
          return (
            <li key={event.id} data-testid="invoice-history-event" className="rounded-xl border border-border bg-surface px-4 py-3">
              <p className="font-medium">{title}</p>
              <p className="text-sm text-muted">
                {formatPakistanDateTime(event.created_at)}
                {event.mine ? " · by you" : ""}
              </p>
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
