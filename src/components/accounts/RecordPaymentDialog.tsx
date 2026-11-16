"use client";

import { useEffect, useState } from "react";
import { PaymentPreview } from "@/components/accounts/PaymentPreview";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/Field";
import { Banner } from "@/components/ui/States";
import { getPaymentPreview, newEntryId, postPayment } from "@/lib/accounts/client";
import type { PaymentPreview as Preview } from "@/lib/accounts/types";
import { ClientApiError } from "@/lib/api/client";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { isValidMoney, parseMoneyToPaisa } from "@/lib/money";
import { todayInPakistan } from "@/lib/orders/dates";

/**
 * Records a cash payment from the store. Before saving it shows what the payment will do (the balance after and the
 * items it settles, oldest first), worked out by the server. One entry id is created for each open form and sent
 * unchanged on every retry, so a double tap, a refresh or a slow network records one payment.
 */
export function RecordPaymentDialog({ open, storeId, onClose, onDone }: { open: boolean; storeId: string; onClose: () => void; onDone: () => void }) {
  return (
    <Dialog open={open} title="Record payment" onClose={onClose}>
      <Body storeId={storeId} onClose={onClose} onDone={onDone} />
    </Dialog>
  );
}

type PreviewState = { key: string; preview?: Preview; error?: string };

function Body({ storeId, onClose, onDone }: { storeId: string; onClose: () => void; onDone: () => void }) {
  const [entryId] = useState(() => newEntryId());
  const today = todayInPakistan();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [state, setState] = useState<PreviewState | null>(null);

  const trimmed = amount.trim();
  const paisa = isValidMoney(trimmed) ? parseMoneyToPaisa(trimmed) : null;
  const validAmount = paisa !== null && paisa > 0;
  const debounced = useDebouncedValue(validAmount ? trimmed : "", 300);

  useEffect(() => {
    if (debounced === "") return;
    const controller = new AbortController();
    getPaymentPreview(storeId, debounced, controller.signal)
      .then((preview) => setState({ key: debounced, preview }))
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setState({ key: debounced, error: e instanceof ClientApiError ? e.message : "Something went wrong. Please try again." });
      });
    return () => controller.abort();
  }, [debounced, storeId]);

  const current = validAmount && state?.key === trimmed ? state : null;

  async function submit() {
    const next: Record<string, string> = {};
    if (!validAmount) next.amount = "Enter an amount above 0 with at most two decimals.";
    if (date === "" || date > today) next.date = "Choose a date up to today.";
    if (reference.length > 100) next.reference = "Use at most 100 characters.";
    setFields(next);
    setError(null);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      await postPayment(storeId, { id: entryId, amount: trimmed, date, reference: reference.trim() === "" ? null : reference.trim() });
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
      <TextInput
        id="payment-amount"
        label="Amount received (PKR)"
        required
        inputMode="decimal"
        autoComplete="off"
        placeholder="15000.00"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={fields.amount}
        data-testid="payment-amount"
      />
      <TextInput
        id="payment-date"
        label="Date received"
        type="date"
        required
        max={today}
        min="2000-01-01"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        error={fields.date}
        data-testid="payment-date"
      />
      <TextInput
        id="payment-reference"
        label="Reference (optional)"
        maxLength={100}
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        error={fields.reference}
        hint="For example a receipt number. Cash is the only method for now."
        data-testid="payment-reference"
      />
      {validAmount ? (
        current?.preview ? (
          <PaymentPreview preview={current.preview} />
        ) : current?.error ? (
          <Banner kind="warning">The preview could not be loaded ({current.error}). You can still save the payment.</Banner>
        ) : (
          <p className="text-sm text-muted" role="status" data-testid="payment-preview-loading">
            Working out what this payment will do…
          </p>
        )
      ) : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} data-testid="payment-save">
          Save payment
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
