"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/States";
import { ClientApiError } from "@/lib/api/client";
import { invoicesApiUrl, invoiceUrl, postCreateInvoice } from "@/lib/invoices/client";
import { formatInvoiceMoney, INVOICE_STATUS_LABEL } from "@/lib/invoices/status";
import type { InvoicePage, InvoiceSummaryRow } from "@/lib/invoices/types";
import { useApiResource } from "@/lib/hooks/useApiResource";
import type { OrderStatus } from "@/lib/orders/types";

function invoiceLabel(row: InvoiceSummaryRow): string {
  return row.status === "draft" ? "Draft invoice" : (row.number_label ?? "Invoice");
}

/**
 * The invoice part of the order screen: "Create invoice" for a confirmed order without a live invoice, "Open draft"
 * or "View invoice" for the live one, and the earlier (cancelled) invoices. A draft or cancelled order gets no
 * create button.
 */
export function OrderInvoiceAction({ orderId, orderStatus }: { orderId: string; orderStatus: OrderStatus }) {
  const router = useRouter();
  const { data, error, loading, retry } = useApiResource<InvoicePage>(orderStatus === "draft" ? null : invoicesApiUrl({ status: "all", store: "", from: "", to: "", q: "" }, { limit: 50, offset: 0 }, orderId));
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  if (orderStatus === "draft") return null;
  if (loading) return <div role="status" aria-label="Loading invoices" className="h-14 animate-pulse rounded-xl border border-border bg-slate-100" data-testid="order-invoice-loading" />;
  if (error || !data) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-danger" data-testid="order-invoice-error">
        <span>{error ?? "Something went wrong. Please try again."}</span>
        <Button variant="secondary" onClick={retry}>
          Retry
        </Button>
      </div>
    );
  }

  const live = data.items.find((i) => i.status === "draft" || i.status === "issued");
  const earlier = data.items.filter((i) => i.status === "cancelled");

  async function create() {
    setBusy(true);
    setCreateError(null);
    try {
      const { invoice } = await postCreateInvoice(orderId);
      router.push(invoiceUrl(invoice.id));
    } catch (e) {
      setCreateError(e instanceof ClientApiError ? e.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <section aria-label="Invoice" className="space-y-2" data-testid="order-invoice">
      {live ? (
        <Link
          href={invoiceUrl(live.id)}
          data-testid="view-invoice"
          className="flex min-h-14 items-center gap-3 rounded-xl border border-primary/40 bg-primary-soft px-4 py-2 font-medium text-primary-strong hover:border-primary"
        >
          <FileText size={22} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block" data-testid="view-invoice-label">
              {live.status === "draft" ? "Open draft invoice" : `View invoice ${invoiceLabel(live)}`}
            </span>
            <span className="block text-sm font-normal">
              {INVOICE_STATUS_LABEL[live.status]} · {formatInvoiceMoney(live.grand_total)}
            </span>
          </span>
        </Link>
      ) : orderStatus === "confirmed" ? (
        <Button onClick={() => void create()} loading={busy} data-testid="create-invoice">
          <FileText size={18} aria-hidden="true" />
          Create invoice
        </Button>
      ) : null}
      {createError ? <Banner kind="error">{createError}</Banner> : null}
      {earlier.length > 0 ? (
        <ul className="space-y-1 text-sm text-muted" data-testid="earlier-invoices">
          {earlier.map((row) => (
            <li key={row.id}>
              <Link href={invoiceUrl(row.id)} className="inline-flex min-h-11 items-center underline" data-testid="earlier-invoice">
                {invoiceLabel(row)} · {INVOICE_STATUS_LABEL[row.status]} · {formatInvoiceMoney(row.grand_total)}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
