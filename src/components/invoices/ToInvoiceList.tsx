"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/States";
import { ClientApiError } from "@/lib/api/client";
import { invoiceUrl, postCreateInvoice } from "@/lib/invoices/client";
import type { ToInvoiceRow } from "@/lib/invoices/types";
import { formatPakistanDateTime } from "@/lib/orders/dates";
import { formatOrderNumber } from "@/lib/orders/number";

function Row({ row }: { row: ToInvoiceRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { invoice } = await postCreateInvoice(row.order_id);
      router.push(invoiceUrl(invoice.id));
    } catch (e) {
      setError(e instanceof ClientApiError ? e.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <li data-testid="to-invoice-item" data-order-id={row.order_id} className="space-y-2 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/orders/${row.order_id}`} className="inline-flex min-h-11 items-center font-semibold text-primary underline" data-testid="to-invoice-order">
            {formatOrderNumber(row.order_number)}
          </Link>
          <p className="truncate" dir="auto" data-testid="to-invoice-store">
            {row.store_name}
          </p>
          <p className="text-sm text-muted">Confirmed {formatPakistanDateTime(row.confirmed_at)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-sm text-muted">{row.line_count.toLocaleString("en-US")} {row.line_count === 1 ? "line" : "lines"}</span>
          {row.lines_without_price > 0 ? <Badge tone="warning">{row.lines_without_price} without a price</Badge> : null}
        </div>
      </div>
      {row.draft_invoice_id ? (
        <Link
          href={invoiceUrl(row.draft_invoice_id)}
          data-testid="open-draft"
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-base font-medium hover:bg-slate-100 sm:w-auto"
        >
          <FileText size={18} aria-hidden="true" />
          Open draft invoice
        </Link>
      ) : (
        <Button onClick={() => void create()} loading={busy} data-testid="create-invoice-row" className="w-full sm:w-auto">
          <FileText size={18} aria-hidden="true" />
          Create invoice
        </Button>
      )}
      {error ? <Banner kind="error">{error}</Banner> : null}
    </li>
  );
}

/** The confirmed orders that still need an invoice. The Home count is the length of this list. */
export function ToInvoiceList({ items }: { items: ToInvoiceRow[] }) {
  return (
    <ul className="space-y-3" data-testid="to-invoice-list">
      {items.map((row) => (
        <Row key={row.order_id} row={row} />
      ))}
    </ul>
  );
}
