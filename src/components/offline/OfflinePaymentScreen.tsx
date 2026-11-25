"use client";

import { Store } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Select, TextInput } from "@/components/ui/Field";
import { LoadingBlock } from "@/components/ui/Spinner";
import { Banner, EmptyState, ErrorState } from "@/components/ui/States";
import type { PaymentFields } from "@/lib/accounts/payment-input";
import { formatWaiting } from "@/lib/device/payments";
import type { StoredStore } from "@/lib/device/schema";
import { shellHref } from "@/lib/device/shell-route";
import { newId } from "@/lib/ids";
import { todayInPakistan } from "@/lib/orders/dates";
import { DevicePaymentCard } from "./DevicePaymentCard";
import { useOffline } from "./OfflineProvider";

// Record payment without the internet (Module 011). The payment is kept on this phone and sent when the connection returns.
// This screen never shows a store's amount owed and never works out what a payment settles: only the server can do that.

type Load = { kind: "loading" } | { kind: "ready"; stores: StoredStore[] } | { kind: "error"; message: string };

const SAVED_TEXT = "Saved on this phone. It is not in the store's account until it is sent.";

function storeLabel(store: StoredStore): string {
  if (store.pending) return `${store.name} (waiting to be sent)`;
  return store.is_active ? store.name : `${store.name} (inactive)`;
}

export function OfflinePaymentScreen() {
  const { runtime, status, cacheAge, recordPayment } = useOffline();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);

  const [storeId, setStoreId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => todayInPakistan());
  const [reference, setReference] = useState("");
  const [fields, setFields] = useState<PaymentFields & { store?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  /** The key of the payment on this form: made once, so a double tap or a second Save of the same form is one payment. */
  const formKey = useRef<string | null>(null);

  const db = runtime?.db ?? null;
  const storesKey = `${status?.pendingStoreIds.join(",") ?? ""}|${cacheAge?.storesUpdatedAt ?? ""}`;

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    db.getAll("stores")
      .then((rows) => {
        if (!cancelled) setLoad({ kind: "ready", stores: [...rows].sort((a, b) => a.name.localeCompare(b.name)) });
      })
      .catch(() => {
        if (!cancelled) setLoad({ kind: "error", message: "The stores on this phone could not be read." });
      });
    return () => {
      cancelled = true;
    };
  }, [db, storesKey, reloads]);

  const retry = useCallback(() => {
    setLoad({ kind: "loading" });
    setReloads((n) => n + 1);
  }, []);

  if (!db) return <LoadingBlock label="Opening the stores on this phone…" />;
  if (load.kind === "loading") return <LoadingBlock label="Reading the stores on this phone…" />;
  if (load.kind === "error") return <ErrorState message={load.message} onRetry={retry} />;

  if (load.stores.length === 0) {
    return (
      <div data-testid="offline-payment-screen" className="space-y-4">
        <h1 className="text-2xl font-semibold">Record payment</h1>
        <EmptyState
          icon={Store}
          title="No stores on this phone yet"
          description="Open the app once online, or take an order for a new store first."
          action={<ButtonLink href={shellHref({ kind: "new_order" })}>Take an order for a new store</ButtonLink>}
        />
      </div>
    );
  }

  const stores = load.stores;
  const waiting = (status?.items ?? []).filter((i) => i.kind === "payment");
  const forStore = storeId === "" ? [] : waiting.filter((i) => i.storeId === storeId);
  const total = status?.waitingTotal ?? { count: 0, paisa: 0 };

  async function submit() {
    if (submitting.current) return;
    setError(null);
    setSaved(false);
    if (storeId === "") {
      setFields({ store: "Choose a store." });
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const key = formKey.current ?? (formKey.current = newId());
      const result = await recordPayment({ storeId, input: { amount, date, reference }, paymentId: key });
      if (result.ok || result.reason === "duplicate") {
        // A repeat of the same form (a double tap) finds its own key already saved: it is one payment, saved once.
        setFields({});
        setAmount("");
        setReference("");
        setSaved(true);
        formKey.current = null;
      } else if (result.reason === "invalid") {
        setFields(result.fields);
      } else {
        setFields({});
        setError(result.message);
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div data-testid="offline-payment-screen" className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Record payment</h1>
        <p className="text-muted">Cash received from a store. It is kept on this phone and sent when the connection returns.</p>
      </div>
      <p className="text-sm text-muted">The server works out what this payment settles when it is sent.</p>
      {total.count > 0 ? (
        <p className="text-sm font-medium text-warning" data-testid="payments-waiting-total">
          {formatWaiting(total)}
        </p>
      ) : null}
      <form
        className="space-y-3"
        data-unsaved-guard
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Select
          id="payment-store"
          label="Store"
          required
          value={storeId}
          onChange={(e) => {
            setStoreId(e.target.value);
            setSaved(false);
            setFields((f) => ({ ...f, store: undefined }));
          }}
          error={fields.store}
          data-testid="payment-store"
        >
          <option value="">Choose a store</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {storeLabel(s)}
            </option>
          ))}
        </Select>
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
          max={todayInPakistan()}
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
        {saved ? (
          <div data-testid="payment-saved">
            <Banner kind="info">{SAVED_TEXT}</Banner>
          </div>
        ) : null}
        {error ? <Banner kind="error">{error}</Banner> : null}
        <Button type="submit" loading={busy} data-testid="payment-save">
          Save payment
        </Button>
      </form>

      <section className="space-y-2" aria-label="Payments waiting on this phone">
        <h2 className="text-lg font-semibold">Waiting on this phone</h2>
        {storeId === "" ? (
          <p className="text-sm text-muted">Choose a store to see its waiting payments.</p>
        ) : forStore.length === 0 ? (
          <p className="text-sm text-muted" data-testid="payments-none-waiting">
            No payments are waiting for this store.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="payments-waiting-list">
            {forStore.map((item) => (
              <DevicePaymentCard key={item.orderId} item={item} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
