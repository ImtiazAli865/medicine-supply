import { Loader2 } from "lucide-react";

export function Spinner({ size = 24, label = "Loading" }: { size?: number; label?: string }) {
  return (
    <span role={label ? "status" : undefined} className="inline-flex items-center gap-2 text-muted">
      <Loader2 size={size} className="animate-spin" aria-hidden="true" />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

/** Centered loading block used while a list or page is loading. */
export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center" data-testid="loading">
      <Spinner size={28} label={label} />
    </div>
  );
}
