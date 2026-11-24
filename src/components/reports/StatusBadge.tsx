import { Badge } from "@/components/ui/Badge";
import { figureBadge, type FigureKind } from "@/lib/reports/labels";
import type { FigureStatus } from "@/lib/reports/types";

/** "Estimate", "Estimate · Incomplete", "Realized" or "Realized · Incomplete": words, never colour alone. */
export function StatusBadge({ kind, status }: { kind: FigureKind; status: FigureStatus }) {
  return (
    <span data-testid="report-status" data-kind={kind} data-status={status}>
      <Badge tone={status === "incomplete" ? "warning" : "neutral"}>{figureBadge(kind, status)}</Badge>
    </span>
  );
}
