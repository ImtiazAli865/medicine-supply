import { formatPKR } from "@/lib/money";
import { NOT_AVAILABLE } from "@/lib/reports/labels";

/** A large, clear amount. A profit that is not available (null) is written as "Not available", never as zero. */
export function MoneyFigure({ value, label, testId }: { value: string | null; label: string; testId?: string }) {
  return (
    <div>
      <p className="text-sm text-muted">{label}</p>
      <p className={`text-2xl font-semibold ${value === null ? "text-muted" : ""}`} data-testid={testId}>
        {value === null ? NOT_AVAILABLE : formatPKR(value)}
      </p>
    </div>
  );
}
