"use client";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Banner } from "@/components/ui/States";

/** Final check before confirming: prices are recorded as of now. */
export function ConfirmOrderDialog({
  open,
  onClose,
  onConfirm,
  busy,
  error,
  lineCount,
  notRegisteredCount,
  unpricedCount,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
  error: string | null;
  lineCount: number;
  notRegisteredCount: number;
  unpricedCount: number;
}) {
  return (
    <Dialog open={open} title="Confirm this order?" onClose={busy ? () => undefined : onClose}>
      <div className="space-y-3">
        <p>
          The order has {lineCount} {lineCount === 1 ? "line" : "lines"}. Prices are recorded as of now and will not change if the catalog prices change later.
        </p>
        {unpricedCount > 0 ? (
          <p className="text-sm text-muted">
            {unpricedCount} {unpricedCount === 1 ? "line has" : "lines have"} no selling price. That does not stop the order; a price is needed before an invoice.
          </p>
        ) : null}
        {notRegisteredCount > 0 ? (
          <p className="text-sm text-muted">
            {notRegisteredCount} {notRegisteredCount === 1 ? "line is" : "lines are"} not registered yet. They stay on the order as you typed them.
          </p>
        ) : null}
        {error ? <Banner kind="error">{error}</Banner> : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={onConfirm} loading={busy} data-testid="confirm-order-yes">
            Confirm order
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Not yet
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
