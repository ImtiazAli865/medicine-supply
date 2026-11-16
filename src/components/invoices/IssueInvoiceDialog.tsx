"use client";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/Field";
import { Banner } from "@/components/ui/States";
import { formatInvoiceMoney } from "@/lib/invoices/status";
import { compareMoney, formatPKR, isValidMoney, subtractMoney } from "@/lib/money";

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
  payment,
  onPaymentChange,
  paymentError,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
  error: string | null;
  billedLines: number;
  grandTotal: string;
  storeName: string;
  /** The text of the optional "Payment received now" field. */
  payment: string;
  onPaymentChange: (text: string) => void;
  paymentError: string | null;
}) {
  const trimmed = payment.trim();
  const valid = trimmed !== "" && isValidMoney(trimmed) && (compareMoney(trimmed, "0") ?? 0) > 0;
  // Informational only: the server decides. It uses the exact paisa helpers, never floating point.
  const over = valid && compareMoney(trimmed, grandTotal) === 1 ? subtractMoney(trimmed, grandTotal) : null;
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
          wrong later, you can cancel it with a reason and make a new one. The total is added to the store account.
        </p>
        <TextInput
          id="issue-payment"
          label="Payment received now (optional)"
          inputMode="decimal"
          autoComplete="off"
          placeholder="For example 3000.00"
          value={payment}
          onChange={(e) => onPaymentChange(e.target.value)}
          error={paymentError ?? undefined}
          hint="Cash received at delivery. It is recorded together with the invoice, or not at all."
          data-testid="issue-payment"
        />
        {over ? (
          <p className="text-sm text-muted" data-testid="issue-payment-advance">
            This is more than the invoice total: {formatPKR(over)} will be kept as an advance for this store.
          </p>
        ) : null}
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
