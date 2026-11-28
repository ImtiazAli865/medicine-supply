"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatPKR } from "@/lib/money";
import type { ShownPrice } from "@/lib/orders/editor-state";
import { catalogMoved, needsPriceConfirmation, parsePriceInput, PRICE_MESSAGE } from "@/lib/orders/price";
import type { OrderLineInput } from "@/lib/orders/types";

/**
 * The price of one draft line (Module 012): change it for this order, remember it as the store's rate, or go back to the
 * automatic price. A price far from the catalog price is asked about before it is used. No price is ever computed.
 */
export function LinePriceEditor({
  line,
  shown,
  onPrice,
}: {
  line: OrderLineInput;
  shown: ShownPrice;
  onPrice: (patch: Pick<OrderLineInput, "price" | "remember" | "rate_version">) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const typed = shown.source === "typed";
  const inputId = `price-${line.id}`;
  const rememberVersion = shown.rate?.version ?? null;

  function accept(price: string) {
    // The new price keeps the tick: it is the same line's agreement being corrected.
    onPrice({ price, ...(line.remember ? { remember: true, rate_version: line.rate_version ?? rememberVersion } : {}) });
    setOpen(false);
    setAsking(null);
    setError(null);
  }

  function submit() {
    const price = parsePriceInput(text);
    if (price === null) {
      setError(PRICE_MESSAGE);
      return;
    }
    if (needsPriceConfirmation(price, shown.catalog)) {
      setAsking(price);
      setError(null);
      return;
    }
    accept(price);
  }

  return (
    <div className="space-y-2" data-testid="line-price-editor">
      {shown.rate && catalogMoved(shown.rate, shown.catalog) ? (
        <p role="status" className="text-sm text-warning" data-testid="rate-moved">
          This store&apos;s rate {formatPKR(shown.rate.rate)} was agreed when the catalog price was{" "}
          {shown.rate.catalog_price_at_set === null ? "not set" : formatPKR(shown.rate.catalog_price_at_set)}; it is now{" "}
          {shown.catalog === null ? "not set" : formatPKR(shown.catalog)}.
        </p>
      ) : null}

      {open ? (
        <div className="space-y-2">
          <label htmlFor={inputId} className="block text-sm font-medium">
            Price (PKR)
          </label>
          <input
            id={inputId}
            inputMode="decimal"
            autoFocus
            value={text}
            aria-invalid={error ? true : undefined}
            className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base"
            onChange={(e) => {
              setText(e.target.value);
              setAsking(null);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          {asking ? (
            <div className="space-y-2 rounded-lg border border-border p-3" data-testid="price-far">
              <p className="text-sm">
                {formatPKR(asking)} is far from the catalog price {formatPKR(shown.catalog)}. Use it?
              </p>
              <div className="flex flex-wrap gap-2">
                <Button data-testid="price-far-yes" onClick={() => accept(asking)}>
                  Yes, use it
                </Button>
                <Button variant="secondary" onClick={() => setAsking(null)}>
                  No, change it
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button data-testid="price-use" onClick={submit}>
                Use this price
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            data-testid="change-price"
            onClick={() => {
              setText(shown.price ?? "");
              setError(null);
              setAsking(null);
              setOpen(true);
            }}
          >
            {shown.price === null ? "Set a price" : "Change price"}
          </Button>
          {typed ? (
            <Button variant="ghost" data-testid="price-automatic" onClick={() => onPrice({ price: null, remember: false })}>
              Use the automatic price
            </Button>
          ) : null}
        </div>
      )}

      {typed && !open ? (
        shown.unitMatches ? (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5"
              data-testid="remember-rate"
              checked={line.remember === true}
              onChange={(e) =>
                onPrice({ price: line.price ?? shown.price, remember: e.target.checked, rate_version: e.target.checked ? rememberVersion : null })
              }
            />
            Remember for this store
          </label>
        ) : shown.productUnit ? (
          <p className="text-sm text-muted">A rate can only be remembered for the medicine&apos;s own unit ({shown.productUnit}).</p>
        ) : null
      ) : null}
    </div>
  );
}
