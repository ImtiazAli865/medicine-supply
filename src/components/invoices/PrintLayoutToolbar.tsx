"use client";

import { Check, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { PrintButton } from "@/components/market/PrintButton";
import { invoicePrintUrl } from "@/lib/invoices/client";
import { PRINT_LAYOUT_LABEL, type PrintLayout } from "@/lib/invoices/status";

/** What the toolbar needs to offer the "Show Account Summary" choice. */
export interface SummaryControl {
  /** True for an issued invoice that has a saved snapshot. */
  available: boolean;
  /** The current choice (the address says so; when it is absent the Settings default decided). */
  on: boolean;
  /** Why the choice is not offered, in plain words (shown instead of the control). */
  unavailableReason: string | null;
}

/**
 * The toolbar of the invoice print page. It is hidden when printing. The layout and the "Show Account Summary" choice
 * are real links, so the address always says what is on screen and both choices survive a layout change. The browser
 * print dialog also offers "Save as PDF".
 */
export function PrintLayoutToolbar({
  invoiceId,
  layout,
  backHref,
  backLabel,
  summary,
}: {
  invoiceId: string;
  layout: PrintLayout;
  backHref: string;
  backLabel: string;
  summary?: SummaryControl;
}) {
  const summaryChoice = summary?.available ? summary.on : undefined;
  return (
    <div className="space-y-3 print:hidden" data-testid="print-toolbar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={backHref} className="inline-flex min-h-11 items-center gap-1 text-primary">
          <ChevronLeft size={20} aria-hidden="true" /> {backLabel}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Print layout" className="inline-flex overflow-hidden rounded-lg border border-border">
            {(["a4", "thermal"] as const).map((option) => (
              <Link
                key={option}
                href={invoicePrintUrl(invoiceId, option, summaryChoice)}
                replace
                aria-current={option === layout ? "page" : undefined}
                data-testid={`layout-${option}`}
                className={`inline-flex min-h-11 min-w-20 items-center justify-center px-4 font-medium ${option === layout ? "bg-primary text-white" : "bg-surface text-foreground hover:bg-slate-100"}`}
              >
                {PRINT_LAYOUT_LABEL[option]}
              </Link>
            ))}
          </nav>
          <PrintButton />
        </div>
      </div>
      {summary ? (
        summary.available ? (
          <Link
            href={invoicePrintUrl(invoiceId, layout, !summary.on)}
            replace
            role="checkbox"
            aria-checked={summary.on}
            data-testid="summary-toggle"
            className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-border bg-surface px-4 font-medium hover:bg-slate-100"
          >
            <span
              aria-hidden="true"
              className={`inline-flex h-6 w-6 items-center justify-center rounded border ${summary.on ? "border-primary bg-primary text-white" : "border-slate-400 bg-surface"}`}
            >
              {summary.on ? <Check size={16} /> : null}
            </span>
            Show Account Summary
          </Link>
        ) : (
          <p className="text-sm text-muted" data-testid="summary-unavailable">
            {summary.unavailableReason ?? "The Account Summary is not available for this invoice."}
          </p>
        )
      ) : null}
    </div>
  );
}
