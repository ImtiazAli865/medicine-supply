"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { PrintButton } from "@/components/market/PrintButton";
import { invoicePrintUrl } from "@/lib/invoices/client";
import { PRINT_LAYOUT_LABEL, type PrintLayout } from "@/lib/invoices/status";

/**
 * The toolbar of the invoice print page. It is hidden when printing. The layout is chosen with real links, so the
 * address always says which layout is on screen. The browser print dialog also offers "Save as PDF".
 */
export function PrintLayoutToolbar({ invoiceId, layout, backHref, backLabel }: { invoiceId: string; layout: PrintLayout; backHref: string; backLabel: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 print:hidden" data-testid="print-toolbar">
      <Link href={backHref} className="inline-flex min-h-11 items-center gap-1 text-primary">
        <ChevronLeft size={20} aria-hidden="true" /> {backLabel}
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Print layout" className="inline-flex overflow-hidden rounded-lg border border-border">
          {(["a4", "thermal"] as const).map((option) => (
            <Link
              key={option}
              href={invoicePrintUrl(invoiceId, option)}
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
  );
}
