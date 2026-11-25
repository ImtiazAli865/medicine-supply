"use client";

import { AlertTriangle, HardDrive, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/Field";
import { Banner } from "@/components/ui/States";
import type { PaymentFields } from "@/lib/accounts/payment-input";
import type { SyncItem } from "@/lib/device/sync-center";
import { formatPKR } from "@/lib/money";
import { useOffline } from "./OfflineProvider";

const LABELS: Record<SyncItem["state"], string> = {
  waiting: "Waiting. It is not in the store's account yet.",
  blocked: "Waiting for its store to be created first.",
  syncing: "Sending…",
  failed: "Waiting. It will be tried again.",
  conflict: "Needs your attention",
  similar: "Needs your attention",
};

/** One cash payment that the server has not confirmed (Module 011), with its own honest state. It never shows an amount owed. */
export function DevicePaymentCard({ item }: { item: SyncItem }) {
  const { storeNames, removePayment, center } = useOffline();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const payment = item.payment;
  const [amount, setAmount] = useState(payment?.amount ?? "");
  const [date, setDate] = useState(payment?.date ?? "");
  const [reference, setReference] = useState(payment?.reference ?? "");
  const [fixFields, setFixFields] = useState<PaymentFields>({});
  const [fixError, setFixError] = useState<string | null>(null);
  if (!payment) return null;

  const storeName = storeNames[item.storeId] ?? "Store on this phone";
  const money = formatPKR(payment.amount);
  const attention = item.state === "conflict";
  const Icon = item.state === "syncing" ? Loader2 : attention ? AlertTriangle : HardDrive;

  async function confirmRemove() {
    setBusy(true);
    setProblem(null);
    try {
      const removed = await removePayment(item.orderId);
      if (removed) setConfirming(false);
      else setProblem("This payment cannot be removed from here: it may already have been sent. It can only be sent again.");
    } finally {
      setBusy(false);
    }
  }

  async function sendCorrected() {
    if (!center) return;
    setBusy(true);
    setFixError(null);
    try {
      const result = await center.correctAndResend(item.orderId, { amount, date, reference });
      if (result.ok) {
        setFixing(false);
        setFixFields({});
      } else if ("fields" in result) {
        setFixFields(result.fields);
      } else {
        setFixError(result.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <li data-testid="device-payment" data-state={item.state}>
      <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold" dir="auto" data-testid="device-payment-store">
            {storeName}
          </p>
          <p className="text-lg font-semibold" data-testid="device-payment-amount">
            {money}
          </p>
        </div>
        <p className="text-sm text-muted">
          Received on {payment.date}
          {payment.reference ? (
            <>
              {" · Reference "}
              <span dir="auto" data-testid="device-payment-reference">
                {payment.reference}
              </span>
            </>
          ) : null}
        </p>
        <p data-testid="device-payment-state" className={`flex flex-wrap items-center gap-2 text-sm font-medium ${attention ? "text-danger" : "text-warning"}`}>
          <Icon size={18} className={item.state === "syncing" ? "animate-spin" : undefined} aria-hidden="true" />
          {LABELS[item.state]}
        </p>
        {item.reason && item.state !== "syncing" ? (
          <p className="text-sm text-muted" dir="auto" data-testid="device-payment-reason">
            {item.reason}
          </p>
        ) : null}
        {attention ? (
          <p className="text-sm text-muted" data-testid="device-payment-kept">
            It stays on this phone until you decide. Nothing is sent for it by itself.
          </p>
        ) : null}

        {fixing && payment.conflict === "refused" ? (
          <form
            className="space-y-3 rounded-lg bg-warning-soft p-3"
            data-testid="device-payment-correct"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void sendCorrected();
            }}
          >
            <TextInput
              id={`fix-amount-${item.orderId}`}
              label="Amount received (PKR)"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              error={fixFields.amount}
              data-testid="device-payment-fix-amount"
            />
            <TextInput
              id={`fix-date-${item.orderId}`}
              label="Date received"
              type="date"
              min="2000-01-01"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              error={fixFields.date}
              data-testid="device-payment-fix-date"
            />
            <TextInput
              id={`fix-reference-${item.orderId}`}
              label="Reference (optional)"
              maxLength={100}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              error={fixFields.reference}
              data-testid="device-payment-fix-reference"
            />
            {fixError ? <Banner kind="error">{fixError}</Banner> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy} data-testid="device-payment-fix-send">
                Correct and send again
              </Button>
              <Button variant="secondary" onClick={() => setFixing(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {item.state === "waiting" ? (
            <Button variant="secondary" onClick={() => center?.retry(item.orderId)} data-testid="device-payment-send-now">
              Send now
            </Button>
          ) : null}
          {attention ? (
            <Button variant="secondary" onClick={() => center?.retry(item.orderId)} data-testid="device-payment-retry">
              Try again
            </Button>
          ) : null}
          {attention && payment.conflict === "refused" && !fixing ? (
            <Button variant="secondary" onClick={() => setFixing(true)} data-testid="device-payment-correct-open">
              Correct the details
            </Button>
          ) : null}
          {payment.canRemove ? (
            <Button variant="secondary" onClick={() => setConfirming(true)} data-testid="device-payment-remove">
              Remove
            </Button>
          ) : (
            <p className="min-h-11 content-center text-sm text-muted" data-testid="device-payment-sent">
              Sent, waiting for the answer
            </p>
          )}
        </div>
      </div>
      <Dialog open={confirming} title="Remove this payment?" onClose={() => (busy ? undefined : setConfirming(false))}>
        <div className="space-y-3" data-testid="device-payment-confirm">
          <p>
            <span className="font-semibold">{money}</span> for{" "}
            <span className="font-semibold" dir="auto">
              {storeName}
            </span>{" "}
            will be removed from this phone and will never be sent to the store&apos;s account. This cannot be undone.
          </p>
          {problem ? <Banner kind="error">{problem}</Banner> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" loading={busy} onClick={() => void confirmRemove()} data-testid="device-payment-remove-confirm">
              Remove payment
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy} data-testid="device-payment-remove-cancel">
              Keep it
            </Button>
          </div>
        </div>
      </Dialog>
    </li>
  );
}
