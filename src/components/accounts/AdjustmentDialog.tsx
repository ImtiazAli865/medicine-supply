"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select, TextInput } from "@/components/ui/Field";
import { Banner } from "@/components/ui/States";
import { newEntryId, postAdjustment } from "@/lib/accounts/client";
import { ADJUSTMENT_DIRECTION_LABEL, MAX_REASON_LENGTH } from "@/lib/accounts/status";
import type { AdjustmentDirection } from "@/lib/accounts/types";
import { ClientApiError } from "@/lib/api/client";
import { isValidMoney, parseMoneyToPaisa } from "@/lib/money";
import { todayInPakistan } from "@/lib/orders/dates";

/**
 * Writes off a small amount, or adds a small amount, on a store account. A reason is required and shows in the
 * history and on the statement. One entry id is created for each open form and sent unchanged on every retry, so a
 * double tap records one adjustment.
 */
export function AdjustmentDialog({ open, storeId, onClose, onDone }: { open: boolean; storeId: string; onClose: () => void; onDone: () => void }) {
  return (
    <Dialog open={open} title="Adjust the balance" onClose={onClose}>
      <Body storeId={storeId} onClose={onClose} onDone={onDone} />
    </Dialog>
  );
}

function Body({ storeId, onClose, onDone }: { storeId: string; onClose: () => void; onDone: () => void }) {
  const [entryId] = useState(() => newEntryId());
  const today = todayInPakistan();
  const [direction, setDirection] = useState<AdjustmentDirection>("reduce");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit() {
    const next: Record<string, string> = {};
    const paisa = isValidMoney(amount.trim()) ? parseMoneyToPaisa(amount.trim()) : null;
    if (paisa === null || paisa <= 0) next.amount = "Enter an amount above 0 with at most two decimals.";
    if (reason.trim() === "") next.reason = "Write the reason.";
    else if (reason.trim().length > MAX_REASON_LENGTH) next.reason = `Use at most ${MAX_REASON_LENGTH} characters.`;
    setFields(next);
    setError(null);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      await postAdjustment(storeId, { id: entryId, amount: amount.trim(), direction, reason: reason.trim(), date: null });
      onDone();
    } catch (e) {
      if (e instanceof ClientApiError && e.fields) setFields(e.fields);
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
      <p className="text-sm text-muted">
        Use this for a small amount you forgive or add, for example a rounding. It is dated today ({today}). To undo it later, reverse it from the entries.
      </p>
      <Select id="adjustment-direction" label="What to do" value={direction} onChange={(e) => setDirection(e.target.value as AdjustmentDirection)} data-testid="adjustment-direction">
        <option value="reduce">{ADJUSTMENT_DIRECTION_LABEL.reduce}</option>
        <option value="increase">{ADJUSTMENT_DIRECTION_LABEL.increase}</option>
      </Select>
      <TextInput
        id="adjustment-amount"
        label="Amount (PKR)"
        required
        inputMode="decimal"
        autoComplete="off"
        placeholder="50.00"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={fields.amount}
        data-testid="adjustment-amount"
      />
      <TextInput
        id="adjustment-reason"
        label="Reason"
        required
        maxLength={MAX_REASON_LENGTH}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={fields.reason}
        hint="Shown in the history and on the statement."
        data-testid="adjustment-reason"
      />
      {error ? <Banner kind="error">{error}</Banner> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} data-testid="adjustment-save">
          Save adjustment
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
