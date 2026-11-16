"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select, TextInput } from "@/components/ui/Field";
import { Banner } from "@/components/ui/States";
import { newEntryId, postOpeningBalance } from "@/lib/accounts/client";
import { OPENING_DIRECTION_LABEL } from "@/lib/accounts/status";
import type { OpeningDirection } from "@/lib/accounts/types";
import { ClientApiError } from "@/lib/api/client";
import { todayInPakistan } from "@/lib/orders/dates";
import { isValidMoney, parseMoneyToPaisa } from "@/lib/money";

/**
 * Adds an opening balance: the old balance of the store from the paper khata, as on a date. It can be added on any
 * day. The dialog says that invoices issued before the store accounts are NOT in the account and must not be counted
 * again here. One entry id is created for each open form and sent unchanged on every retry, so a double tap records
 * one entry.
 */
export function OpeningBalanceDialog({ open, storeId, onClose, onDone }: { open: boolean; storeId: string; onClose: () => void; onDone: () => void }) {
  return (
    <Dialog open={open} title="Add opening balance" onClose={onClose}>
      <Body storeId={storeId} onClose={onClose} onDone={onDone} />
    </Dialog>
  );
}

function Body({ storeId, onClose, onDone }: { storeId: string; onClose: () => void; onDone: () => void }) {
  // The Dialog mounts this body only while it is open, so each opening gets its own entry id.
  const [entryId] = useState(() => newEntryId());
  const today = todayInPakistan();
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<OpeningDirection>("owes");
  const [asOn, setAsOn] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit() {
    const next: Record<string, string> = {};
    const paisa = isValidMoney(amount.trim()) ? parseMoneyToPaisa(amount.trim()) : null;
    if (paisa === null || paisa <= 0) next.amount = "Enter an amount above 0 with at most two decimals.";
    if (asOn === "" || asOn > today) next.as_on = "Choose a date up to today.";
    if (note.length > 200) next.note = "Use at most 200 characters.";
    setFields(next);
    setError(null);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      await postOpeningBalance(storeId, {
        id: entryId,
        amount: amount.trim(),
        direction,
        as_on: asOn,
        note: note.trim() === "" ? null : note.trim(),
      });
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
      <Banner kind="warning">
        Invoices issued before the store accounts were added are <strong>not</strong> in this account. Do not include them in the opening balance, or they
        will be counted twice.
      </Banner>
      <Select id="opening-direction" label="Who owes whom" value={direction} onChange={(e) => setDirection(e.target.value as OpeningDirection)} data-testid="opening-direction">
        <option value="owes">{OPENING_DIRECTION_LABEL.owes}</option>
        <option value="advance">{OPENING_DIRECTION_LABEL.advance}</option>
      </Select>
      <TextInput
        id="opening-amount"
        label="Amount (PKR)"
        required
        inputMode="decimal"
        autoComplete="off"
        placeholder="12000.00"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={fields.amount}
        data-testid="opening-amount"
      />
      <TextInput
        id="opening-date"
        label="As on"
        type="date"
        required
        max={today}
        min="2000-01-01"
        value={asOn}
        onChange={(e) => setAsOn(e.target.value)}
        error={fields.as_on ?? fields.date}
        data-testid="opening-date"
      />
      <TextInput
        id="opening-note"
        label="Note (optional)"
        maxLength={200}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        error={fields.note}
        hint="For example: from the paper khata."
        data-testid="opening-note"
      />
      {error ? <Banner kind="error">{error}</Banner> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} data-testid="opening-save">
          Save opening balance
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
