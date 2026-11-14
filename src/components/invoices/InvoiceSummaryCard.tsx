"use client";

import { AlertCircle, CheckCircle2, FileText } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ClientApiError } from "@/lib/api/client";
import { getInvoiceSummary } from "@/lib/invoices/client";
import type { InvoiceSummary } from "@/lib/invoices/types";

type State = { key: number; summary: InvoiceSummary | null; error: string | null };

/**
 * Home: how many confirmed orders are still waiting for an invoice. The number comes from the same rows as the "To
 * invoice" list, so it always equals the length of that list. Fetched when Home opens, never cached. A failed request
 * shows an error with Retry, never "nothing to invoice".
 */
export function InvoiceSummaryCard() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    let cancelled = false;
    getInvoiceSummary()
      .then((summary) => {
        if (!cancelled) setState({ key: attempt, summary, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ key: attempt, summary: null, error: error instanceof ClientApiError ? error.message : "Something went wrong. Please try again." });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const current = state?.key === attempt ? state : null;

  return (
    <section aria-labelledby="invoice-heading" className="space-y-2" data-testid="invoice-summary">
      <h2 id="invoice-heading" className="text-lg font-semibold">
        Invoices
      </h2>
      {!current ? (
        <div role="status" aria-label="Loading" className="h-16 animate-pulse rounded-xl border border-border bg-slate-100" data-testid="invoice-summary-loading" />
      ) : current.error || !current.summary ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-danger" data-testid="invoice-summary-error">
          <span className="flex items-center gap-2">
            <AlertCircle size={20} aria-hidden="true" />
            {current.error ?? "Something went wrong. Please try again."}
          </span>
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </Button>
        </div>
      ) : current.summary.to_invoice === 0 ? (
        <Link href="/invoices" data-testid="invoice-summary-link" className="flex min-h-14 items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 font-medium hover:border-primary">
          <CheckCircle2 size={20} className="text-primary" aria-hidden="true" />
          <span data-testid="invoice-summary-count">No orders waiting for an invoice.</span>
        </Link>
      ) : (
        <Link
          href="/invoices?tab=to-invoice"
          data-testid="invoice-summary-link"
          className="flex min-h-14 items-center gap-2 rounded-xl border border-warning/40 bg-warning-soft px-4 py-2 font-medium text-warning hover:border-warning"
        >
          <FileText size={20} aria-hidden="true" />
          <span data-testid="invoice-summary-count">
            {current.summary.to_invoice.toLocaleString("en-US")} {current.summary.to_invoice === 1 ? "order" : "orders"} to invoice
          </span>
        </Link>
      )}
    </section>
  );
}
