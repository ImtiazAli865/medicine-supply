"use client";

import { Clock } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useOffline } from "@/components/offline/OfflineProvider";
import { Button } from "@/components/ui/Button";
import { formatPaisa, formatWaiting, type WaitingTotal } from "@/lib/device/payments";
import type { SyncItem } from "@/lib/device/sync-center";
import { formatPKR } from "@/lib/money";

// A balance that is shown while cash payments wait on this phone is the server's balance, and it does not include them yet.
// These pieces say so everywhere a balance is shown on screen (Module 011, Principle III: "pending sync"). They are used by the
// store account screen, the store accounts list, Home and the Reports balances screen. They are never used on an invoice print
// or on the store statement: those are for the store, and show only what the server has recorded.

const STATE_TEXT: Record<SyncItem["state"], string> = {
  waiting: "Waiting",
  blocked: "Waiting for its store",
  syncing: "Sending…",
  failed: "Waiting",
  conflict: "Needs your attention",
  similar: "Needs your attention",
};

/** The payments of one store that wait on this phone (null when there are none or this phone keeps no data). */
export function useWaitingForStore(storeId: string): WaitingTotal | null {
  const { status } = useOffline();
  const found = status?.waitingByStore[storeId];
  return found && found.count > 0 ? found : null;
}

/** All payments that wait on this phone (null when there are none). */
export function useWaitingTotal(): WaitingTotal | null {
  const { status } = useOffline();
  return status && status.waitingTotal.count > 0 ? status.waitingTotal : null;
}

/** Calls `onConfirmed` when the number of waiting payments of the store falls: the server confirmed one, so the balance changed. */
export function useOnPaymentsConfirmed(storeId: string, onConfirmed: () => void): void {
  const { status } = useOffline();
  const count = status?.waitingByStore[storeId]?.count ?? 0;
  const before = useRef(count);
  const callback = useRef(onConfirmed);
  useEffect(() => {
    callback.current = onConfirmed;
  });
  useEffect(() => {
    if (count < before.current) callback.current();
    before.current = count;
  }, [count]);
}

/** A small label next to a balance that does not yet include payments waiting on this phone. */
export function PendingSyncBadge({ storeId, testId = "balance-pending-sync" }: { storeId: string; testId?: string }) {
  const waiting = useWaitingForStore(storeId);
  if (!waiting) return null;
  return (
    <span data-testid={testId} className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">
      <Clock size={14} aria-hidden="true" />
      Pending sync
    </span>
  );
}

/** The short form for a list row: how many payments wait for that store. */
export function PendingSyncRowNote({ storeId }: { storeId: string }) {
  const waiting = useWaitingForStore(storeId);
  if (!waiting) return null;
  return (
    <span className="block text-sm font-medium text-warning" data-testid="account-item-pending">
      {waiting.count} {waiting.count === 1 ? "payment" : "payments"} waiting, not counted yet
    </span>
  );
}

/** The full note of the store account screen: the sentence, and each waiting payment with its amount, date and reference. */
export function PendingSyncNote({ storeId }: { storeId: string }) {
  const { status, center } = useOffline();
  const waiting = useWaitingForStore(storeId);
  if (!status || !waiting) return null;
  const items = status.items.filter((i) => i.kind === "payment" && i.storeId === storeId && i.payment);
  return (
    <section aria-label="Payments waiting on this phone" className="space-y-2 rounded-xl border border-warning/40 bg-warning-soft p-4" data-testid="pending-sync-note">
      <p className="flex flex-wrap items-center gap-2 font-semibold text-warning" data-testid="pending-sync-text">
        <Clock size={18} aria-hidden="true" />
        {formatWaiting(waiting)}
      </p>
      <p className="text-sm text-muted">The balance above is the server&apos;s. It does not include these payments until the server confirms them.</p>
      <ul className="space-y-1" data-testid="pending-payments">
        {items.map((item) => (
          <li key={item.orderId} className="flex flex-wrap items-baseline justify-between gap-2 text-sm" data-testid="pending-payment-row" data-state={item.state}>
            <span className="font-medium">{formatPKR(item.payment!.amount)}</span>
            <span className="text-muted">
              {item.payment!.date}
              {item.payment!.reference ? ` · ${item.payment!.reference}` : ""} · {STATE_TEXT[item.state]}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        {status.paused ? (
          <p className="text-sm text-muted" data-testid="pending-paused">
            Sending is paused. Resume it in Settings.
          </p>
        ) : (
          <Button variant="secondary" onClick={() => center?.retry()} data-testid="pending-send-now">
            Send now
          </Button>
        )}
        <Link href="/settings" className="inline-flex min-h-11 items-center font-medium text-primary underline">
          See waiting payments in Settings
        </Link>
      </div>
    </section>
  );
}

/** Under a total of balances (Home, Reports): the total leaves out the payments that wait on this phone. */
export function PendingSyncTotalNote() {
  const waiting = useWaitingTotal();
  if (!waiting) return null;
  return (
    <p className="text-sm font-medium text-warning" data-testid="accounts-pending-note">
      This total leaves out {waiting.count} {waiting.count === 1 ? "payment" : "payments"} waiting on this phone ({formatPaisa(waiting.paisa)}, not counted yet).
    </p>
  );
}
