import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { formatInvoiceMoney, INVOICE_STATUS_LABEL, invoiceHeading } from "@/lib/invoices/status";
import type { InvoiceSummaryRow } from "@/lib/invoices/types";
import { formatOrderNumber } from "@/lib/orders/number";

/** One invoice in the list: number (or Draft), store, order, date, grand total and status. A 44 px or taller row. */
export function InvoiceListItem({ invoice }: { invoice: InvoiceSummaryRow }) {
  const tone = invoice.status === "cancelled" ? "danger" : invoice.status === "draft" ? "neutral" : "success";
  return (
    <li>
      <Link
        href={`/invoices/${invoice.id}`}
        data-testid="invoice-item"
        className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 hover:border-primary"
      >
        <span className="min-w-0">
          <span className="block font-semibold" data-testid="invoice-item-heading">
            {invoiceHeading(invoice.status, invoice.number_label)}
          </span>
          <span className="block truncate text-muted" dir="auto">
            {invoice.store_name}
          </span>
          <span className="block text-sm text-muted">
            {formatOrderNumber(invoice.order_number)}
            {invoice.invoice_date ? ` · ${invoice.invoice_date}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-semibold" data-testid="invoice-item-total">
            {formatInvoiceMoney(invoice.grand_total)}
          </span>
          <Badge tone={tone}>{INVOICE_STATUS_LABEL[invoice.status]}</Badge>
        </span>
      </Link>
    </li>
  );
}
