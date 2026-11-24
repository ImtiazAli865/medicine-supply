"use client";

import { Pill } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { formatPKR } from "@/lib/money";
import { reportUrl, useReport } from "@/lib/reports/client";
import { medicineDetails } from "@/lib/reports/format";
import { ROUNDING_NOTE } from "@/lib/reports/labels";
import type { MedicineReport, MedicineRow } from "@/lib/reports/types";
import { ListControls } from "./ListControls";
import { ListTotalsCard } from "./ListTotalsCard";
import { Pager } from "./Pager";
import { ProfitPair } from "./ProfitPair";
import { ReportShell } from "./ReportShell";
import { usePeriod } from "./usePeriod";

const PAGE = 20;

function MedicineCard({ row }: { row: MedicineRow }) {
  return (
    <li className="space-y-2 rounded-xl border border-border bg-surface p-3" data-testid="report-row">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="font-medium">{row.name}</p>
        <p className="font-semibold">{formatPKR(row.sales)}</p>
      </div>
      {medicineDetails(row) ? <p className="text-sm text-muted">{medicineDetails(row)}</p> : null}
      <p className="text-sm text-muted">
        {row.billed_quantity} {row.unit} billed
      </p>
      <ProfitPair estimated={row.estimated} realized={row.realized} />
    </li>
  );
}

/** Sales by medicine: grouped by the medicine itself and its unit, never by similar text; typed lines apart. */
export function MedicinesReportScreen() {
  const period = usePeriod();
  const { range, q, sort, offset } = period;
  const query = { from: range.from, to: range.to, q, sort, limit: PAGE, offset };
  const { data, error, loading, retry } = useReport<MedicineReport>(reportUrl("/api/reports/medicines", query));

  const searching = q.trim() !== "";
  const empty = data !== undefined && data.total === 0 && data.typed_rows.length === 0;
  const status = loading ? "loading" : error !== undefined || !data ? "error" : empty ? "empty" : "ready";

  return (
    <ReportShell
      title="Sales by medicine"
      description="Each medicine with its strength, form, pack size and maker is its own row. Nothing is merged by similar name."
      period={period}
      controls={<ListControls period={period} searchLabel="Search medicines" />}
      status={status}
      errorMessage={error}
      onRetry={retry}
      empty={
        searching
          ? { icon: Pill, title: "No medicine matches your search", description: "Clear the search box or try another name.", action: undefined }
          : { icon: Pill, title: "No medicines sold in this period", description: "Choose another period, or issue an invoice from an order.", action: <ButtonLink href="/orders">Go to orders</ButtonLink> }
      }
      exportHref={reportUrl("/api/reports/export", { report: "medicines", from: range.from, to: range.to, q, sort })}
    >
      {data ? (
        <div className="space-y-4">
          {searching ? (
            <>
              <ListTotalsCard title="Totals of the rows shown" totals={data.filtered_totals} testId="report-filtered-totals" />
              <p className="text-sm text-muted" data-testid="report-filter-note">
                These totals cover only the rows that match your search. Whole period: {formatPKR(data.totals.sales)}.
              </p>
            </>
          ) : (
            <ListTotalsCard title="All medicines" totals={data.totals} testId="report-totals" />
          )}

          <ul className="space-y-2" data-testid="report-rows">
            {data.items.map((row) => (
              <MedicineCard key={row.key} row={row} />
            ))}
          </ul>
          <Pager offset={offset} pageSize={PAGE} shown={data.items.length} total={data.total} onOffset={period.setOffset} />

          {data.typed_rows.length > 0 ? (
            <section aria-label="Not registered" className="space-y-2" data-testid="report-typed">
              <h2 className="text-lg font-semibold">Not registered</h2>
              <p className="text-sm text-muted">Sold under the name that was typed on the order. Register the medicine to see its cost.</p>
              <ul className="space-y-2">
                {data.typed_rows.map((row) => (
                  <MedicineCard key={row.key} row={row} />
                ))}
              </ul>
            </section>
          ) : null}
          <p className="text-sm text-muted">{ROUNDING_NOTE}</p>
        </div>
      ) : null}
    </ReportShell>
  );
}
