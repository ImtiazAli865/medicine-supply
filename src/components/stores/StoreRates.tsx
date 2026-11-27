"use client";

import { Tag } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { LoadingBlock } from "@/components/ui/Spinner";
import { Banner, EmptyState, ErrorState } from "@/components/ui/States";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import { useApiResource } from "@/lib/hooks/useApiResource";
import { formatPKR } from "@/lib/money";
import { formatPakistanDateTime } from "@/lib/orders/dates";
import { catalogMoved, parsePriceInput, PRICE_MESSAGE } from "@/lib/orders/price";
import { RATES_CHANGED_EVENT } from "@/lib/orders/save-transport";
import type { StoreRate, StoreRatesResponse } from "@/lib/rates/types";

// The store's own prices (Module 012): every remembered rate, with the medicine's identity and the catalog price now.
// A rate is changed or removed only by the supplier; confirmed orders and invoices never change.

function messageOf(error: unknown): string {
  return error instanceof ClientApiError ? (error.fields?.rate ?? error.message) : "Something went wrong. Please try again.";
}

function facts(rate: StoreRate): string {
  const p = rate.product;
  return [p.strength, p.dosage_form, p.pack_size, p.manufacturer].filter(Boolean).join(" · ");
}

export function StoreRates({ storeId }: { storeId: string }) {
  const resource = useApiResource<StoreRatesResponse>(`/api/stores/${storeId}/rates`);
  const [editing, setEditing] = useState<StoreRate | null>(null);
  const [removing, setRemoving] = useState<StoreRate | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    setEditing(null);
    setRemoving(null);
    setError(null);
  }

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      window.dispatchEvent(new CustomEvent(RATES_CHANGED_EVENT));
      close();
      resource.retry();
    } catch (e) {
      // Changed elsewhere: show the new list, so nothing is overwritten unseen.
      if (e instanceof ClientApiError && e.code === "version_conflict") resource.retry();
      setError(e instanceof ClientApiError && e.code === "version_conflict" ? "This rate was changed elsewhere. Close this and check the new value." : messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!editing) return;
    const price = parsePriceInput(text);
    if (price === null) {
      setError(PRICE_MESSAGE);
      return;
    }
    void run(() => fetchJson(`/api/stores/${storeId}/rates/${editing.product_id}`, { method: "PUT", json: { rate: price, expected_version: editing.version } }));
  }

  const items = resource.data?.items ?? [];

  return (
    <section aria-label="This store's prices" className="space-y-3" data-testid="store-rates">
      <h2 className="text-lg font-semibold">This store&apos;s prices</h2>
      {resource.loading ? (
        <LoadingBlock label="Loading prices…" />
      ) : resource.error ? (
        <ErrorState message={resource.error} onRetry={resource.retry} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="No special prices yet"
          description="This store is billed the catalog price. To remember a rate, change a line's price on an order and tick Remember for this store."
          action={<ButtonLink href={`/orders/new`}>Take an order</ButtonLink>}
        />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {items.map((r) => (
            <li key={r.product_id} className="space-y-2 px-4 py-3" data-testid="store-rate">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold" dir="auto">
                    {r.product.name}
                  </p>
                  <p className="text-sm text-muted" dir="auto">
                    {[facts(r), `per ${r.product.unit}`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <p className="text-right font-semibold" data-testid="store-rate-value">
                  {formatPKR(r.rate)}
                </p>
              </div>
              <p className="text-sm text-muted">
                Set {formatPakistanDateTime(r.updated_at)} · Catalog price now: {r.catalog_price === null ? "not set" : formatPKR(r.catalog_price)}
              </p>
              {!r.product.is_active ? <Badge>Medicine inactive</Badge> : null}
              {catalogMoved({ rate: r.rate, version: r.version, catalog_price_at_set: r.catalog_price_at_set }, r.catalog_price) ? (
                <p className="text-sm text-warning" data-testid="store-rate-moved">
                  Agreed when the catalog price was {r.catalog_price_at_set === null ? "not set" : formatPKR(r.catalog_price_at_set)}.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  data-testid="store-rate-change"
                  onClick={() => {
                    setText(r.rate);
                    setError(null);
                    setEditing(r);
                  }}
                >
                  Change
                </Button>
                <Button variant="ghost" data-testid="store-rate-remove" onClick={() => setRemoving(r)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} title="Change this store's price" onClose={busy ? () => undefined : close}>
        <div className="space-y-3">
          <p dir="auto">{editing?.product.name}</p>
          <label htmlFor="store-rate-input" className="block text-sm font-medium">
            Price (PKR)
          </label>
          <input
            id="store-rate-input"
            inputMode="decimal"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base"
          />
          {error ? <Banner kind="error">{error}</Banner> : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} loading={busy} data-testid="store-rate-save">
              Save price
            </Button>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={removing !== null} title="Remove this store's price?" onClose={busy ? () => undefined : close}>
        <div className="space-y-3">
          <p>
            New orders of this store will use the catalog price for <span dir="auto">{removing?.product.name}</span>. Confirmed orders and invoices do not change.
          </p>
          {error ? <Banner kind="error">{error}</Banner> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              loading={busy}
              data-testid="store-rate-remove-yes"
              onClick={() =>
                removing &&
                void run(() => fetchJson(`/api/stores/${storeId}/rates/${removing.product_id}?expected_version=${removing.version}`, { method: "DELETE" }))
              }
            >
              Remove price
            </Button>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Keep it
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
