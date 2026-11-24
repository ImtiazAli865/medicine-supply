"use client";

import { BarChart3 } from "lucide-react";
import { formatPKR } from "@/lib/money";
import { reportUrl, useReport } from "@/lib/reports/client";
import { profitSummary } from "@/lib/reports/format";
import { excludedSentence, ROUNDING_NOTE, SERIES_NOTE } from "@/lib/reports/labels";
import { bucketLabel } from "@/lib/reports/period";
import type { SalesReport } from "@/lib/reports/types";
import { ButtonLink } from "@/components/ui/Button";
import { BarList } from "./BarList";
import { FigureCard } from "./FigureCard";
import { ReportShell } from "./ReportShell";
import { usePeriod } from "./usePeriod";

/** Sales and profit: totals, the estimated and the realized profit with their labels, what was left out, a series. */
export function SalesReportScreen() {
  const period = usePeriod();
  const { range, group } = period;
  const query = { from: range.from, to: range.to, group };
  const { data, error, loading, retry } = useReport<SalesReport>(reportUrl("/api/reports/sales", query));
  const costMissingHref = reportUrl("/reports/cost-missing", { from: range.from, to: range.to });

  const empty = data !== undefined && data.totals.invoices === 0;
  const status = loading ? "loading" : error !== undefined || !data ? "error" : empty ? "empty" : "ready";
  const excluded = data ? excludedSentence(data.excluded.cancelled_invoices, data.excluded.draft_invoices) : "";

  return (
    <ReportShell
      title="Sales and profit"
      description="Issued invoices only. Profit is shown two ways and each is labelled."
      period={period}
      showGroup
      status={status}
      errorMessage={error}
      onRetry={retry}
      empty={{
        icon: BarChart3,
        title: "No issued invoices in this period",
        description: `${excluded ? excluded + " " : ""}Choose another period, or issue an invoice from an order.`,
        action: <ButtonLink href="/orders">Go to orders</ButtonLink>,
      }}
      exportHref={reportUrl("/api/reports/export", { report: "sales", ...query })}
    >
      {data ? (
        <div className="space-y-4">
          <section aria-label="Sales" className="rounded-xl border border-border bg-surface p-4">
            <p className="text-sm text-muted">Sales</p>
            <p className="text-3xl font-semibold" data-testid="report-total-sales">
              {formatPKR(data.totals.sales)}
            </p>
            <p className="text-sm text-muted" data-testid="report-total-invoices">
              {data.totals.invoices} {data.totals.invoices === 1 ? "invoice" : "invoices"} · {data.totals.quantity} billed
            </p>
          </section>

          {excluded ? (
            <p className="text-sm text-muted" data-testid="report-excluded">
              {excluded}
            </p>
          ) : null}

          <FigureCard kind="estimated" figure={data.estimated} costMissingHref={costMissingHref} />
          <FigureCard kind="realized" figure={data.realized} costMissingHref={costMissingHref} />

          <section aria-label="Over time" className="space-y-2">
            <h2 className="text-lg font-semibold">By {group}</h2>
            <BarList
              testId="report-series"
              rows={data.series.map((b) => ({
                key: b.bucket_start,
                label: bucketLabel(group, b.bucket_start, b.bucket_end, b.partial, range),
                amount: b.sales,
                detail: (
                  <ul className="space-y-0.5">
                    <li>
                      Sales {formatPKR(b.sales)} · {b.invoices} {b.invoices === 1 ? "invoice" : "invoices"}
                    </li>
                    <li>Estimated profit {profitSummary(b.estimated)}</li>
                    <li>Realized profit {profitSummary(b.realized)}</li>
                  </ul>
                ),
              }))}
            />
            <p className="text-sm text-muted">
              {SERIES_NOTE} {ROUNDING_NOTE}
            </p>
          </section>
        </div>
      ) : null}
    </ReportShell>
  );
}
