import Link from "next/link";
import { formatPKR } from "@/lib/money";
import { figureExplanation, figureTitle, missingSentence, type FigureKind } from "@/lib/reports/labels";
import type { ProfitFigure } from "@/lib/reports/types";
import { MoneyFigure } from "./MoneyFigure";
import { StatusBadge } from "./StatusBadge";

/**
 * One profit figure (Estimated or Realized): its label, the profit (or "Not available"), the cost it is made of, how
 * many lines have no cost and a link to the Cost missing list. The two figures are always separate cards.
 */
export function FigureCard({ kind, figure, costMissingHref }: { kind: FigureKind; figure: ProfitFigure; costMissingHref: string }) {
  const missing = missingSentence(figure.missing_lines, figure.missing_sales);
  return (
    <section aria-label={figureTitle(kind)} className="space-y-2 rounded-xl border border-border bg-surface p-4" data-testid={kind === "estimated" ? "report-estimated" : "report-realized"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{figureTitle(kind)}</h2>
        <StatusBadge kind={kind} status={figure.status} />
      </div>
      <MoneyFigure value={figure.profit} label="Profit" testId={`${kind}-profit`} />
      <p className="text-sm text-muted">
        Cost {formatPKR(figure.cost)} on sales of {formatPKR(figure.covered_sales)}
        {figure.missing_lines > 0 ? " (only the lines that have a cost)" : ""}
      </p>
      {missing ? (
        <p className="text-sm font-medium text-warning" data-testid="report-missing">
          {missing}.{" "}
          <Link href={costMissingHref} className="inline-flex min-h-11 items-center underline" data-testid="report-missing-link">
            See which medicines
          </Link>
        </p>
      ) : null}
      <p className="text-sm text-muted">{figureExplanation(kind)}</p>
    </section>
  );
}
