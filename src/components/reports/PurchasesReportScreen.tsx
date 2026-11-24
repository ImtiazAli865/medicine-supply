"use client";

import { ShoppingCart } from "lucide-react";
import { formatPKR } from "@/lib/money";
import { reportUrl, useReport } from "@/lib/reports/client";
import { cancelledEntriesSentence, purchaseNoCostSentence, SERIES_NOTE } from "@/lib/reports/labels";
import { bucketLabel } from "@/lib/reports/period";
import type { PurchaseReport } from "@/lib/reports/types";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { BarList } from "./BarList";
import { ReportShell } from "./ReportShell";
import { usePeriod } from "./usePeriod";

/** The purchase summary: money spent from actual quantity and actual cost; entries without a cost are named. */
export function PurchasesReportScreen() {
  const period = usePeriod();
  const { range, group } = period;
  const query = { from: range.from, to: range.to, group };
  const { data, error, loading, retry } = useReport<PurchaseReport>(reportUrl("/api/reports/purchases", query));

  const cancelledOnly = data !== undefined && data.totals.entries === 0 && data.totals.cancelled_entries_left_out > 0;
  const empty = data !== undefined && data.totals.entries === 0;
  const status = loading ? "loading" : error !== undefined || !data ? "error" : empty ? "empty" : "ready";
  const noCost = data ? purchaseNoCostSentence(data.totals.entries_without_cost, data.totals.quantity_without_cost) : "";
  const cancelled = data ? cancelledEntriesSentence(data.totals.cancelled_entries_left_out) : "";

  return (
    <ReportShell
      title="Purchases"
      description="What you spent at the market, from the quantity and the actual cost you recorded."
      period={period}
      showGroup
      status={status}
      errorMessage={error}
      onRetry={retry}
      empty={{
        icon: ShoppingCart,
        title: "No purchases recorded in this period",
        description: `${cancelledOnly ? cancelled + " " : ""}Record what you buy on the market list. A tick alone is never counted as a purchase.`,
        action: <ButtonLink href="/market-list">Open the market list</ButtonLink>,
      }}
      exportHref={reportUrl("/api/reports/export", { report: "purchases", ...query })}
    >
      {data ? (
        <div className="space-y-4">
          <section aria-label="Total" className="space-y-2 rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted">Spent</p>
              <span data-testid="report-status" data-status={data.totals.status}>
                <Badge tone={data.totals.status === "incomplete" ? "warning" : "neutral"}>{data.totals.status === "incomplete" ? "Incomplete" : "Complete"}</Badge>
              </span>
            </div>
            <p className="text-3xl font-semibold" data-testid="report-total-cost">
              {formatPKR(data.totals.cost)}
            </p>
            <p className="text-sm text-muted" data-testid="report-total-entries">
              {data.totals.entries} {data.totals.entries === 1 ? "purchase entry" : "purchase entries"}
            </p>
            {noCost ? (
              <p className="text-sm font-medium text-warning" data-testid="report-missing">
                {noCost}
              </p>
            ) : null}
            {cancelled ? (
              <p className="text-sm text-muted" data-testid="report-excluded">
                {cancelled}
              </p>
            ) : null}
          </section>

          <section aria-label="Over time" className="space-y-2">
            <h2 className="text-lg font-semibold">By {group}</h2>
            <BarList
              testId="report-series"
              rows={data.series.map((b) => ({
                key: b.bucket_start,
                label: bucketLabel(group, b.bucket_start, b.bucket_end, b.partial, range),
                amount: b.cost,
                detail: (
                  <p>
                    {formatPKR(b.cost)} · {b.entries} {b.entries === 1 ? "entry" : "entries"}
                    {b.entries_without_cost > 0 ? ` · ${b.entries_without_cost} with no cost recorded` : ""}
                  </p>
                ),
              }))}
            />
            <p className="text-sm text-muted">{SERIES_NOTE}</p>
          </section>
        </div>
      ) : null}
    </ReportShell>
  );
}
