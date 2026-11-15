"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Banner } from "@/components/ui/States";

/**
 * Cancels an issued invoice. A reason is required. The invoice stays in the history with its number and lines, and
 * the order returns to Confirmed so a corrected invoice can be created.
 */
export function CancelInvoiceDialog({
  open,
  label,
  onClose,
  onConfirm,
  busy,
  error,
}: {
  open: boolean;
  label: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <Dialog open={open} title={`Cancel ${label}?`} onClose={busy ? () => undefined : onClose}>
      <Body onClose={onClose} onConfirm={onConfirm} busy={busy} error={error} />
    </Dialog>
  );
}

function Body({ onClose, onConfirm, busy, error }: { onClose: () => void; onConfirm: (reason: string) => void; busy: boolean; error: string | null }) {
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const missing = reason.trim() === "";
  return (
    <div className="space-y-3">
      <p>
        The invoice stays in the history with its number and lines, marked Cancelled. The order becomes Confirmed again, so you can create a corrected
        invoice. This cannot be undone.
      </p>
      <div>
        <label htmlFor="cancel-invoice-reason" className="mb-1 block text-sm font-medium">
          Reason (required)
        </label>
        <textarea
          id="cancel-invoice-reason"
          data-testid="cancel-invoice-reason"
          rows={3}
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base"
        />
        {submitted && missing ? (
          <p role="alert" className="mt-1 text-sm text-danger">
            Write why this invoice is cancelled.
          </p>
        ) : null}
      </div>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="danger"
          loading={busy}
          data-testid="cancel-invoice-confirm"
          onClick={() => {
            setSubmitted(true);
            if (missing) return;
            onConfirm(reason.trim());
          }}
        >
          Cancel invoice
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Keep it
        </Button>
      </div>
    </div>
  );
}
