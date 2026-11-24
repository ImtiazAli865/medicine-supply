"use client";

import { Store } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { formatPKR } from "@/lib/money";
import { reportUrl, useReport } from "@/lib/reports/client";
import { ROUNDING_NOTE } from "@/lib/reports/labels";
import type { StoreReport } from "@/lib/reports/types";
import { ListControls } from "./ListControls";
import { ListTotalsCard } from "./ListTotalsCard";
import { Pager } from "./Pager";
import { ProfitPair } from "./ProfitPair";
import { ReportShell } from "./ReportShell";
import { usePeriod } from "./usePeriod";

const PAGE = 20;

/** Sales by store: each store's sales and both profit figures, sorted and searched, a page at a time. */
export function StoresReportScreen() {
  const period = usePeriod();
  const { range, q, sort, offset } = period;
  const query = { from: range.from, to: range.to, q, sort, limit: PAGE, offset };
  const { data, error, loading, retry } = useReport<StoreReport>(reportUrl("/api/reports/stores", query));

  const searching = q.trim() !== "";
  const empty = data !== undefined && data.total === 0;
  const status = loading ? "loading" : error !== undefined || !data ? "error" : empty ? "empty" : "ready";

  return (
    <ReportShell
      title="Sales by store"
      description="Which stores buy most from you, and what you earn from each."
      period={period}
      controls={<ListControls period={period} searchLabel="Search stores" />}
      status={status}
      errorMessage={error}
      onRetry={retry}
      empty={
        searching
          ? { icon: Store, title: "No store matches your search", description: "Clear the search box or try another name.", action: undefined }
          : { icon: Store, title: "No sales to any store in this period", description: "Choose another period, or issue an invoice from an order.", action: <ButtonLink href="/orders">Go to orders</ButtonLink> }
      }
      exportHref={reportUrl("/api/reports/export", { report: "stores", from: range.from, to: range.to, q, sort })}
    >
      {data ? (
        <div className="space-y-4">
          {searching ? (
            <>
              <ListTotalsCard title="Totals of the stores shown" totals={data.filtered_totals} testId="report-filtered-totals" />
              <p className="text-sm text-muted" data-testid="report-filter-note">
                These totals cover only the stores that match your search. Whole period: {formatPKR(data.totals.sales)}.
              </p>
            </>
          ) : (
            <ListTotalsCard title="All stores" totals={data.totals} testId="report-totals" />
          )}

          <ul className="space-y-2" data-testid="report-rows">
            {data.items.map((row) => (
              <li key={row.store_id} className="space-y-2 rounded-xl border border-border bg-surface p-3" data-testid="report-row">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="font-medium">{row.name}</p>
                  <p className="font-semibold">{formatPKR(row.sales)}</p>
                </div>
                <p className="text-sm text-muted">
                  {row.invoices} {row.invoices === 1 ? "invoice" : "invoices"} · {row.share}% of sales
                </p>
                <ProfitPair estimated={row.estimated} realized={row.realized} />
              </li>
            ))}
          </ul>
          <Pager offset={offset} pageSize={PAGE} shown={data.items.length} total={data.total} onOffset={period.setOffset} />
          <p className="text-sm text-muted">{ROUNDING_NOTE}</p>
        </div>
      ) : null}
    </ReportShell>
  );
}
