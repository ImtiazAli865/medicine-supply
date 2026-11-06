"use client";

import { Button } from "@/components/ui/Button";
import type { StatusCounts } from "@/lib/import/types";

export interface Plan {
  willCreate: number;
  createdSeparate: number;
  skipped: { label: string; count: number }[];
}

/** What exactly will happen on Confirm, computed from the preview and the supplier's choices. */
export function planOf(counts: StatusCounts, createdSeparate: number): Plan {
  return {
    willCreate: counts.new + createdSeparate,
    createdSeparate,
    skipped: [
      { label: "Already exist", count: counts.exists },
      { label: "Similar, not chosen", count: counts.similar - createdSeparate },
      { label: "Duplicate inside the file", count: counts.file_duplicate },
      { label: "SKU already used", count: counts.sku_used },
      { label: "Invalid", count: counts.invalid },
    ].filter((s) => s.count > 0),
  };
}

export function ConfirmPanel({
  plan,
  busy,
  onConfirm,
  onCancel,
}: {
  plan: Plan;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const skippedTotal = plan.skipped.reduce((n, s) => n + s.count, 0);
  return (
    <section aria-labelledby="confirm-title" className="space-y-3 rounded-xl border border-border bg-surface p-4" data-testid="confirm-panel">
      <h2 id="confirm-title" className="text-lg font-semibold">Ready to import?</h2>
      <p data-testid="will-create">
        <strong>{plan.willCreate.toLocaleString("en-US")}</strong> medicine{plan.willCreate === 1 ? "" : "s"} will be created
        {plan.createdSeparate > 0 ? ` (${plan.createdSeparate.toLocaleString("en-US")} as separate similar products)` : ""}.
      </p>
      <p data-testid="will-skip">
        <strong>{skippedTotal.toLocaleString("en-US")}</strong> row{skippedTotal === 1 ? "" : "s"} will be skipped
        {plan.skipped.length > 0 ? `: ${plan.skipped.map((s) => `${s.count.toLocaleString("en-US")} ${s.label.toLowerCase()}`).join(", ")}` : ""}.
      </p>
      <p className="text-sm text-muted">Nothing is saved until you press Confirm. The import is all-or-nothing, and pressing Confirm again never creates duplicates.</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onConfirm} loading={busy} disabled={plan.willCreate === 0} data-testid="confirm-import">
          Confirm import
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Choose another file
        </Button>
      </div>
      {plan.willCreate === 0 ? <p className="text-sm text-warning">There is nothing to create. Fix the file, or choose similar rows to create as separate products.</p> : null}
    </section>
  );
}
