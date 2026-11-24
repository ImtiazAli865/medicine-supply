"use client";

import { FileWarning } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { formatPKR } from "@/lib/money";
import { reportUrl, useReport } from "@/lib/reports/client";
import { medicineDetails } from "@/lib/reports/format";
import { reasonText } from "@/lib/reports/labels";
import { dayLabel } from "@/lib/reports/period";
import type { CostMissingReport, CostMissingRow } from "@/lib/reports/types";
import { ReportShell } from "./ReportShell";
import { usePeriod } from "./usePeriod";

function FixLinks({ row }: { row: CostMissingRow }) {
  if (row.product_id === null) {
    return (
      <Link href="/pending" className="inline-flex min-h-11 items-center text-primary underline">
        Register this medicine first
      </Link>
    );
  }
  return (
    <ul className="flex flex-wrap gap-x-4">
      {row.estimate_missing ? (
        <li>
          <Link href={`/products/${row.product_id}`} className="inline-flex min-h-11 items-center text-primary underline">
            Set a purchase price
          </Link>
        </li>
      ) : null}
      {row.realized_missing
        ? row.realized_dates.map((day) => (
            <li key={day}>
              <Link href={`/market-list?date=${day}`} className="inline-flex min-h-11 items-center text-primary underline" data-testid="cost-missing-date-link">
                Record a purchase for {dayLabel(day)}
              </Link>
            </li>
          ))
        : null}
    </ul>
  );
}

/** Sold medicines that have no cost for a figure, with the reason and where to fix it. This screen changes nothing. */
export function CostMissingScreen() {
  const period = usePeriod();
  const { range } = period;
  const { data, error, loading, retry } = useReport<CostMissingReport>(reportUrl("/api/reports/cost-missing", { from: range.from, to: range.to }));
  const status = loading ? "loading" : error !== undefined || !data ? "error" : data.items.length === 0 ? "empty" : "ready";

  return (
    <ReportShell
      title="Cost missing"
      description="Medicines sold in this period that have no cost, so a profit for them cannot be trusted."
      period={period}
      status={status}
      errorMessage={error}
      onRetry={retry}
      empty={{
        icon: FileWarning,
        title: "No cost is missing in this period",
        description: "Every medicine you sold has a cost for both profit figures, or nothing was sold. Choose another period to check.",
        action: <ButtonLink href="/reports/sales">Open Sales and profit</ButtonLink>,
      }}
      exportHref={reportUrl("/api/reports/export", { report: "cost-missing", from: range.from, to: range.to })}
    >
      {data ? (
        <div className="space-y-3">
          <p className="text-sm text-muted" data-testid="cost-missing-count">
            {data.total} {data.total === 1 ? "medicine" : "medicines"}
            {data.truncated ? " (the first 500 are shown)" : ""}
          </p>
          <ul className="space-y-2">
            {data.items.map((row) => (
              <li key={`${row.product_id ?? row.name}:${row.unit}`} className="space-y-1 rounded-xl border border-border bg-surface p-3" data-testid="cost-missing-row">
                <p className="font-medium">{row.name}</p>
                {medicineDetails(row) ? <p className="text-sm text-muted">{medicineDetails(row)}</p> : null}
                <p className="text-sm">
                  Sold {formatPKR(row.sales_amount)} · {row.billed_quantity} {row.unit} · {row.lines} {row.lines === 1 ? "line" : "lines"}
                </p>
                <p className="flex flex-wrap gap-2">
                  {row.estimate_missing ? <Badge tone="warning">Estimate: no cost</Badge> : null}
                  {row.realized_missing ? <Badge tone="warning">Realized: no cost</Badge> : null}
                </p>
                <p className="text-sm text-muted">{reasonText(row.reason)}</p>
                <FixLinks row={row} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </ReportShell>
  );
}
