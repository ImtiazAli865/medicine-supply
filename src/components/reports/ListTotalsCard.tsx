import { formatPKR } from "@/lib/money";
import type { ListTotals } from "@/lib/reports/types";
import { ProfitPair } from "./ProfitPair";

/** Totals of a list: of the whole period, or (when a search is on) of the rows that match, and it says which. */
export function ListTotalsCard({ title, totals, testId }: { title: string; totals: ListTotals; testId: string }) {
  return (
    <section aria-label={title} className="space-y-2 rounded-xl border border-border bg-surface p-4" data-testid={testId}>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-3xl font-semibold" data-testid={`${testId}-sales`}>
        {formatPKR(totals.sales)}
      </p>
      <p className="text-sm text-muted">
        {totals.invoices} {totals.invoices === 1 ? "invoice" : "invoices"}
      </p>
      <ProfitPair estimated={totals.estimated} realized={totals.realized} />
    </section>
  );
}
