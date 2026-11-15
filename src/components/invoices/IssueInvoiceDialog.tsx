"use client";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Banner } from "@/components/ui/States";
import { formatInvoiceMoney } from "@/lib/invoices/status";

/**
 * Confirms issuing a draft. Says what will be frozen. The confirm button is disabled while the request runs, so a
 * double tap sends one request (and the server would give the same invoice number to a repeat anyway).
 */
export function IssueInvoiceDialog({
  open,
  onClose,
  onConfirm,
  busy,
  error,
  billedLines,
  grandTotal,
  storeName,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
  error: string | null;
  billedLines: number;
  grandTotal: string;
  storeName: string;
}) {
  return (
    <Dialog open={open} title="Issue this invoice?" onClose={busy ? () => undefined : onClose}>
      <div className="space-y-3">
        <p dir="auto">
          {billedLines.toLocaleString("en-US")} {billedLines === 1 ? "line" : "lines"} for {storeName}, total{" "}
          <span className="font-semibold" data-testid="issue-total">
            {formatInvoiceMoney(grandTotal)}
          </span>
          .
        </p>
        <p>
          The invoice gets the next invoice number and is frozen: its lines, prices and totals can never be changed. The order becomes Fulfilled. If it is
          wrong later, you can cancel it with a reason and make a new one.
        </p>
        {error ? <Banner kind="error">{error}</Banner> : null}
        <div className="flex flex-wrap gap-2">
          <Button loading={busy} onClick={onConfirm} data-testid="issue-confirm">
            Issue invoice
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Not yet
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
