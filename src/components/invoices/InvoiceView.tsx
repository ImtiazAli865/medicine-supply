import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { InvoiceAccountSection } from "@/components/invoices/InvoiceAccountSection";
import { InvoiceHistory } from "@/components/invoices/InvoiceHistory";
import { Badge } from "@/components/ui/Badge";
import { formatInvoiceMoney, INVOICE_STATUS_LABEL } from "@/lib/invoices/status";
import type { Invoice } from "@/lib/invoices/types";
import { formatPakistanDateTime } from "@/lib/orders/dates";
import { formatOrderNumber } from "@/lib/orders/number";

function details(parts: Array<string | null>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

/**
 * An issued or cancelled invoice, read-only: the lines, prices and totals are the frozen snapshot. Only billed lines
 * are shown (a line with delivered 0 is stored but not billed). There is no control that edits an issued invoice.
 */
export function InvoiceView({ invoice, actions }: { invoice: Invoice; actions?: ReactNode }) {
  const billed = invoice.lines.filter((l) => l.billed);
  const cancelled = invoice.status === "cancelled";
  return (
    <div className="space-y-4" data-testid="invoice-view">
      <Link href={`/orders/${invoice.order_id}`} className="inline-flex min-h-11 items-center gap-1 text-primary" data-testid="back-to-order">
        <ChevronLeft size={20} aria-hidden="true" /> Order {formatOrderNumber(invoice.order_number)}
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold" data-testid="invoice-heading">
            {invoice.number_label}
          </h1>
          <p className="text-muted" dir="auto" data-testid="invoice-store">
            {invoice.store.name}
          </p>
          <p className="text-sm text-muted" data-testid="invoice-dates">
            Invoice date {invoice.invoice_date}
            {invoice.issued_at ? ` · Issued ${formatPakistanDateTime(invoice.issued_at)}` : ""}
            {invoice.issued_by_me ? " by you" : ""}
          </p>
        </div>
        <span data-testid="invoice-status">
          <Badge tone={cancelled ? "danger" : "success"}>{INVOICE_STATUS_LABEL[invoice.status]}</Badge>
        </span>
      </div>

      {cancelled ? (
        <div role="status" data-testid="invoice-cancelled" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-danger">
          <p className="font-medium">This invoice was cancelled. It stays here with its number.</p>
          {invoice.cancel_reason ? <p dir="auto">Reason: {invoice.cancel_reason}</p> : null}
          {invoice.cancelled_at ? <p className="text-sm">Cancelled {formatPakistanDateTime(invoice.cancelled_at)}</p> : null}
        </div>
      ) : null}

      {actions}

      <InvoiceAccountSection invoice={invoice} />

      <section aria-label="Invoice details" className="space-y-1 rounded-xl border border-border bg-surface p-4 text-sm">
        <p className="font-medium" dir="auto" data-testid="invoice-business">
          {invoice.business.name}
        </p>
        {details([invoice.business.phone, invoice.business.address]) ? <p className="text-muted" dir="auto">{details([invoice.business.phone, invoice.business.address])}</p> : null}
        <p className="pt-1 text-muted">Billed to</p>
        <p className="font-medium" dir="auto">
          {invoice.store.name}
        </p>
        {details([invoice.store.contact_person, invoice.store.phone, invoice.store.address]) ? (
          <p className="text-muted" dir="auto">
            {details([invoice.store.contact_person, invoice.store.phone, invoice.store.address])}
          </p>
        ) : null}
      </section>

      <ul className="space-y-2" data-testid="invoice-lines">
        {billed.map((line) => (
          <li key={line.id} data-testid="invoice-line" className="rounded-xl border border-border bg-surface p-4">
            <p className="font-medium" dir="auto">
              {line.name}
            </p>
            {details([line.strength, line.dosage_form, line.pack_size, line.manufacturer]) ? (
              <p className="text-sm text-muted" dir="auto">
                {details([line.strength, line.dosage_form, line.pack_size, line.manufacturer])}
              </p>
            ) : null}
            <p className="mt-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span>
                {line.delivered_quantity.toLocaleString("en-US")} {line.unit} × {formatInvoiceMoney(line.selling_price)}
              </span>
              <span className="text-base font-semibold" data-testid="invoice-line-total">
                {formatInvoiceMoney(line.line_total)}
              </span>
            </p>
          </li>
        ))}
      </ul>

      <div className="flex items-baseline justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <span className="font-medium">Grand total</span>
        <span className="text-xl font-semibold" data-testid="invoice-grand-total">
          {formatInvoiceMoney(invoice.grand_total)}
        </span>
      </div>

      {invoice.events ? <InvoiceHistory events={invoice.events} /> : null}
    </div>
  );
}
