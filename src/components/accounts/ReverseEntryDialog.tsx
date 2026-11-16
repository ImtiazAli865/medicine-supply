"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/Field";
import { Banner } from "@/components/ui/States";
import { newEntryId, postReverse } from "@/lib/accounts/client";
import { ENTRY_TYPE_LABEL, MAX_REASON_LENGTH } from "@/lib/accounts/status";
import type { LedgerEntry } from "@/lib/accounts/types";
import { ClientApiError } from "@/lib/api/client";
import { formatInvoiceMoney } from "@/lib/invoices/status";

/**
 * Reverses one entry with a required reason. Nothing is edited or deleted: a new reversal entry is added on the
 * opposite side and both stay in the history. One reversal id is created for each open form and sent unchanged on
 * every retry, so a double tap records one reversal.
 */
export function ReverseEntryDialog({
  entry,
  storeId,
  onClose,
  onDone,
}: {
  entry: LedgerEntry | null;
  storeId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <Dialog open={entry !== null} title="Reverse this entry" onClose={onClose}>
      {entry ? <Body key={entry.id} entry={entry} storeId={storeId} onClose={onClose} onDone={onDone} /> : null}
    </Dialog>
  );
}

function Body({ entry, storeId, onClose, onDone }: { entry: LedgerEntry; storeId: string; onClose: () => void; onDone: () => void }) {
  const [reversalId] = useState(() => newEntryId());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);

  async function submit() {
    setError(null);
    setFieldError(undefined);
    if (reason.trim() === "") {
      setFieldError("Write the reason.");
      return;
    }
    if (reason.trim().length > MAX_REASON_LENGTH) {
      setFieldError(`Use at most ${MAX_REASON_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    try {
      await postReverse(storeId, entry.id, { id: reversalId, reason: reason.trim() });
      onDone();
    } catch (e) {
      if (e instanceof ClientApiError && e.fields?.reason) setFieldError(e.fields.reason);
      setError(e instanceof ClientApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-3"
      data-unsaved-guard
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="rounded-lg border border-border bg-surface px-3 py-2" data-testid="reverse-target">
        <span className="block font-semibold">
          {ENTRY_TYPE_LABEL[entry.entry_type]} · {formatInvoiceMoney(entry.amount)}
        </span>
        <span className="block text-sm text-muted">{entry.entry_date}</span>
      </p>
      <p className="text-sm text-muted">
        The entry stays in the history, marked as reversed. A new reversal entry is added today on the opposite side, so the balance goes back to what it
        was before this entry.
      </p>
      <TextInput
        id="reverse-reason"
        label="Reason"
        required
        maxLength={MAX_REASON_LENGTH}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={fieldError}
        data-testid="reverse-reason"
      />
      {error ? <Banner kind="error">{error}</Banner> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} data-testid="reverse-save">
          Reverse entry
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
