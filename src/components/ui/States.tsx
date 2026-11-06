import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Info } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./Button";

/** Empty list: always names the next action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div data-testid="empty-state" className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center">
      <Icon size={40} className="text-primary" aria-hidden="true" />
      <h2 className="text-lg font-semibold">{title}</h2>
      {description ? <p className="max-w-sm text-muted">{description}</p> : null}
      {action}
    </div>
  );
}

/** A failed request: message plus Retry. Never shown in place of the empty state. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div data-testid="error-state" role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft px-6 py-8 text-center">
      <AlertTriangle size={36} className="text-danger" aria-hidden="true" />
      <p className="max-w-sm text-danger">{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

type BannerKind = "info" | "warning" | "error";

const bannerColors: Record<BannerKind, string> = {
  info: "border-primary/30 bg-primary-soft text-primary-strong",
  warning: "border-warning/30 bg-warning-soft text-warning",
  error: "border-danger/30 bg-danger-soft text-danger",
};

/** Inline notice inside a screen or form. */
export function Banner({ kind = "info", children }: { kind?: BannerKind; children: ReactNode }) {
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${bannerColors[kind]}`}>
      <Info size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}
