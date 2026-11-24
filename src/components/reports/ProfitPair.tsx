import { profitText } from "@/lib/reports/labels";
import type { ProfitFigure } from "@/lib/reports/types";
import { StatusBadge } from "./StatusBadge";

/** The estimated and the realized profit of one row, each with its own label. */
export function ProfitPair({ estimated, realized }: { estimated: ProfitFigure; realized: ProfitFigure }) {
  return (
    <ul className="space-y-1" data-testid="report-profits">
      <li className="flex flex-wrap items-center justify-between gap-2">
        <span>
          Estimated profit <span className="font-semibold">{profitText(estimated.profit)}</span>
        </span>
        <StatusBadge kind="estimated" status={estimated.status} />
      </li>
      <li className="flex flex-wrap items-center justify-between gap-2">
        <span>
          Realized profit <span className="font-semibold">{profitText(realized.profit)}</span>
        </span>
        <StatusBadge kind="realized" status={realized.status} />
      </li>
    </ul>
  );
}
