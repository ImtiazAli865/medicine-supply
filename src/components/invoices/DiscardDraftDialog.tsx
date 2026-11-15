"use client";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Banner } from "@/components/ui/States";

/** Discards a draft. No invoice number was ever used and the order is not touched. */
export function DiscardDraftDialog({
  open,
  onClose,
  onConfirm,
  busy,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <Dialog open={open} title="Discard this draft?" onClose={busy ? () => undefined : onClose}>
      <div className="space-y-3">
        <p>The draft invoice is removed. No invoice number was used and the order is not changed. You can create a new draft any time.</p>
        {error ? <Banner kind="error">{error}</Banner> : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" loading={busy} onClick={onConfirm} data-testid="discard-confirm">
            Discard draft
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep it
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
