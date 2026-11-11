"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Banner } from "@/components/ui/States";
import { LIMITS } from "@/lib/orders/editor-state";

/**
 * Discards a draft (the reason is optional) or cancels a confirmed order (a reason is required).
 * The order is kept in the history either way.
 */
export function CancelOrderDialog({
  open,
  mode,
  onClose,
  onConfirm,
  busy,
  error,
}: {
  open: boolean;
  mode: "draft" | "confirmed";
  onClose: () => void;
  onConfirm: (reason: string | null) => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <Dialog open={open} title={mode === "draft" ? "Discard this draft?" : "Cancel this order?"} onClose={busy ? () => undefined : onClose}>
      <Body mode={mode} onClose={onClose} onConfirm={onConfirm} busy={busy} error={error} />
    </Dialog>
  );
}

function Body({ mode, onClose, onConfirm, busy, error }: { mode: "draft" | "confirmed"; onClose: () => void; onConfirm: (reason: string | null) => void; busy: boolean; error: string | null }) {
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const required = mode === "confirmed";
  const missing = required && reason.trim() === "";
  return (
    <div className="space-y-3">
      <p>
        {mode === "draft"
          ? "The draft is kept in the order history as Cancelled. Nothing is erased."
          : "The order stays in the history as Cancelled with its lines and prices. This cannot be undone."}
      </p>
      <div>
        <label htmlFor="cancel-reason" className="mb-1 block text-sm font-medium">
          Reason {required ? "(required)" : "(optional)"}
        </label>
        <textarea
          id="cancel-reason"
          rows={3}
          value={reason}
          maxLength={LIMITS.reason}
          onChange={(e) => setReason(e.target.value)}
          className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base"
        />
        {submitted && missing ? <p role="alert" className="mt-1 text-sm text-danger">Enter a reason for cancelling a confirmed order.</p> : null}
      </div>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="danger"
          loading={busy}
          data-testid="cancel-order-yes"
          onClick={() => {
            setSubmitted(true);
            if (missing) return;
            onConfirm(reason.trim() === "" ? null : reason.trim());
          }}
        >
          {mode === "draft" ? "Discard draft" : "Cancel order"}
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Keep it
        </Button>
      </div>
    </div>
  );
}
