"use client";

import { Minus, Pill, Plus, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { TypedLineForm } from "@/components/orders/TypedLineForm";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { LoadingBlock } from "@/components/ui/Spinner";
import { useMedicineList } from "@/lib/hooks/useMedicineList";
import { cleanTypedName, LIMITS, parseQuantity } from "@/lib/orders/editor-state";
import { formatPKR } from "@/lib/money";
import { sameUnit, type StoreRateMap } from "@/lib/orders/price";
import type { SlimMedicine } from "@/lib/orders/fast-types";

const inputClass = "min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base";
const rangeText = `Quantity must be a whole number from 1 to ${LIMITS.quantityMax.toLocaleString("en-US")}.`;
const QUICK_QUANTITIES = [5, 10, 20, 50] as const;

function detailsOf(medicine: SlimMedicine): string {
  return [medicine.strength, medicine.dosage_form, medicine.pack_size, medicine.manufacturer].filter(Boolean).join(" · ");
}

/** The store's rate for a medicine, only for the medicine's own unit. */
function rateFor(rates: StoreRateMap | null, medicine: SlimMedicine): string | null {
  const rate = rates?.get(medicine.id);
  return rate && sameUnit(rate.unit, medicine.unit) ? rate.rate : null;
}

function ResultButton({
  medicine,
  highlighted,
  disabled,
  onChoose,
  storeRate = null,
}: {
  medicine: SlimMedicine;
  highlighted: boolean;
  disabled: boolean;
  onChoose: (medicine: SlimMedicine) => void;
  /** This store's rate for the medicine, when it has one (Module 012). */
  storeRate?: string | null;
}) {
  const details = detailsOf(medicine);
  return (
    <li>
      <button
        type="button"
        data-testid="medicine-result"
        data-highlighted={highlighted ? "true" : "false"}
        disabled={disabled}
        // Pressing a result must not take the focus away from the search box (that would close the phone keyboard).
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onChoose(medicine)}
        className={`flex min-h-14 w-full flex-col items-start gap-0.5 rounded-lg border bg-surface px-3 py-2 text-left hover:border-primary disabled:opacity-60 ${
          highlighted ? "border-primary ring-2 ring-primary" : "border-border"
        }`}
      >
        <span className="font-semibold" dir="auto">
          {medicine.name}
        </span>
        {details ? (
          <span className="text-sm text-muted" dir="auto">
            {details}
          </span>
        ) : null}
        <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
          Unit: {medicine.unit}
          {storeRate ? (
            <span data-testid="result-store-rate">Store rate {formatPKR(storeRate)}</span>
          ) : medicine.selling_price === null ? (
            <Badge tone="warning">No selling price</Badge>
          ) : null}
        </span>
      </button>
    </li>
  );
}

/**
 * The search box that stays on the order screen (Module 008). Two inputs are always mounted, the search box and the
 * quantity box, so the phone keyboard can stay open while the focus moves between them:
 * choose a result (tap, or Enter when exactly one is left) -> cursor in the quantity (1 selected) -> Enter adds and
 * returns to the search box. Nothing is ever preselected when more than one medicine fits, and digits typed in the
 * name are part of the search, never a quantity.
 */
export function FastAdd({
  disabled,
  onPickProduct,
  onPickTyped,
  rates = null,
}: {
  disabled: boolean;
  /** The order store's rates, shown on the results. */
  rates?: StoreRateMap | null;
  onPickProduct: (medicine: SlimMedicine, quantity: number) => void;
  onPickTyped: (name: string, quantity: number, unit: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<SlimMedicine | null>(null);
  const [qtyText, setQtyText] = useState("1");
  const [qtyError, setQtyError] = useState<string | null>(null);
  const [arrow, setArrow] = useState<number | null>(null);
  const [typing, setTyping] = useState(false);
  const [hintError, setHintError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  const list = useMedicineList(query);
  const hasText = query.trim() !== "";
  const active = arrow !== null && arrow < list.results.length ? arrow : list.highlight;

  function choose(medicine: SlimMedicine) {
    if (disabled) return;
    if (list.hint) {
      // "pan x20": the quantity is used only now, when a result is chosen, and the line is added at once (with an Undo).
      if (list.hint.value === null) {
        setHintError(rangeText); // nothing is added and the typed text is kept
        return;
      }
      onPickProduct(medicine, list.hint.value);
      setQuery("");
      setArrow(null);
      setHintError(null);
      searchRef.current?.focus();
      return;
    }
    // The quantity box is enabled and focused inside the same tap, so the keyboard never closes.
    flushSync(() => {
      setChosen(medicine);
      setQtyText("1");
      setQtyError(null);
      setQuery("");
      setArrow(null);
    });
    qtyRef.current?.focus();
    qtyRef.current?.select();
  }

  function commit() {
    if (!chosen) return;
    const quantity = parseQuantity(qtyText);
    if (quantity === null) {
      setQtyError(rangeText); // nothing is added and what was typed is kept
      return;
    }
    onPickProduct(chosen, quantity);
    // Move the focus first (input to input), then disable the quantity box.
    searchRef.current?.focus();
    setChosen(null);
    setQtyText("1");
    setQtyError(null);
  }

  /** The stepper only fills the quantity box; nothing is added until Enter or the add button. */
  function stepQuantity(delta: number) {
    const base = parseQuantity(qtyText) ?? 1;
    setQtyText(String(Math.min(LIMITS.quantityMax, Math.max(1, base + delta))));
    setQtyError(null);
  }

  function cancelChoice() {
    searchRef.current?.focus();
    setChosen(null);
    setQtyText("1");
    setQtyError(null);
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && list.results.length > 0) {
      event.preventDefault();
      setArrow(((arrow ?? (list.highlight ?? -1)) + 1) % list.results.length);
    } else if (event.key === "ArrowUp" && list.results.length > 0) {
      event.preventDefault();
      setArrow(((arrow ?? (list.highlight ?? list.results.length)) - 1 + list.results.length) % list.results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      // Enter chooses only a highlighted result: the only one left, or one the supplier moved to with the arrow keys.
      if (active !== null && list.results[active]) choose(list.results[active]!);
    }
  }

  function addTyped(name: string, quantity: number, unit: string) {
    onPickTyped(name, quantity, unit);
    setTyping(false);
    setQuery("");
    searchRef.current?.focus();
  }

  const showResults = hasText && !typing;
  const noMatch = showResults && list.results.length === 0 && !list.searching && list.status !== "loading";

  return (
    <section aria-label="Add medicines" className="space-y-3" data-testid="fast-add-section">
      <div className="relative">
        <Search size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          data-testid="fast-search"
          aria-label="Search medicines"
          placeholder="Name, strength, form, maker or code"
          enterKeyHint="go"
          autoComplete="off"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setArrow(null);
            setHintError(null);
          }}
          onKeyDown={onSearchKeyDown}
          dir="auto"
          className="min-h-11 w-full rounded-lg border border-border bg-surface py-2 pl-10 pr-3 text-base"
        />
      </div>

      {list.hint ? (
        <p className="text-sm" data-testid="fast-quantity-tag">
          {list.hint.value === null ? (
            <span className="text-danger">
              &ldquo;{list.hint.text}&rdquo;: {rangeText}
            </span>
          ) : (
            <Badge tone="success">Quantity {list.hint.value}</Badge>
          )}
          <span className="ml-2 text-muted">used when you choose a result</span>
        </p>
      ) : null}
      {hintError ? (
        <p role="alert" className="text-sm text-danger" data-testid="fast-hint-error">
          {hintError}
        </p>
      ) : null}
      {list.status === "loading" ? (
        <p className="text-sm text-muted" data-testid="list-loading">
          Loading your medicines… you can already type.
        </p>
      ) : null}
      {list.status === "too_large" ? (
        <p className="text-sm text-muted" data-testid="too-large-note">
          Your catalog is very large, so results come from the server.
        </p>
      ) : null}
      {list.listError ? (
        <div role="alert" data-testid="list-error" className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-danger">
          <p className="min-w-0 flex-1 text-sm">The medicine list could not be loaded ({list.listError}). Searching still works through the server.</p>
          <Button variant="secondary" onClick={list.refresh} data-testid="list-retry">
            Retry
          </Button>
        </div>
      ) : null}

      {showResults ? (
        <div className="space-y-2" data-testid="medicine-results">
          {list.searchError && list.results.length === 0 ? (
            <ErrorState message={list.searchError} onRetry={list.retrySearch} />
          ) : list.searching && list.results.length === 0 ? (
            <LoadingBlock label="Searching…" />
          ) : noMatch ? (
            <p data-testid="no-matching-medicine" className="rounded-lg bg-slate-100 px-3 py-3 text-center text-muted">
              No matching medicine.
            </p>
          ) : (
            <ul className="space-y-2">
              {list.results.map((medicine, index) => (
                <ResultButton
                  key={medicine.id}
                  medicine={medicine}
                  highlighted={active === index}
                  disabled={disabled}
                  onChoose={choose}
                  storeRate={rateFor(rates, medicine)}
                />
              ))}
            </ul>
          )}
          {list.searchError && list.results.length > 0 ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger" data-testid="search-error">
              <span>{list.searchError}</span>
              <Button variant="secondary" onClick={list.retrySearch}>
                Retry
              </Button>
            </div>
          ) : null}
          {list.more ? (
            <p className="text-sm text-muted" data-testid="more-results">
              More medicines match. Keep typing to narrow the list.
            </p>
          ) : null}
        </div>
      ) : null}

      {list.catalogEmpty && !typing ? (
        <div data-testid="catalog-empty" className="space-y-2 rounded-xl border border-dashed border-border p-4 text-center">
          <Pill size={32} className="mx-auto text-primary" aria-hidden="true" />
          <p className="font-medium">Your catalog is empty.</p>
          <p className="text-sm text-muted">Type the medicine name above to add it as typed, or add or import medicines first.</p>
          <p className="flex flex-wrap justify-center gap-3 text-sm">
            <Link href="/products/new" className="inline-flex min-h-11 items-center text-primary underline">
              Add a medicine
            </Link>
            <Link href="/products/import" className="inline-flex min-h-11 items-center text-primary underline">
              Import a list
            </Link>
          </p>
        </div>
      ) : null}

      {(hasText || list.catalogEmpty) && !typing ? (
        <Button variant="secondary" className="w-full" data-testid="add-as-typed" disabled={disabled} onClick={() => setTyping(true)}>
          {list.results.length === 0 && !list.searching && hasText ? `Add as typed: “${cleanTypedName(query)}”` : "None of these, it is a new medicine"}
        </Button>
      ) : null}

      {typing ? <TypedLineForm initialName={cleanTypedName(query)} onCancel={() => setTyping(false)} onAdd={addTyped} /> : null}

      <div className="space-y-2 rounded-xl border border-border bg-surface p-3" data-testid="fast-quantity-block">
        {chosen ? (
          <div data-testid="fast-chosen">
            <p className="font-semibold" dir="auto">
              {chosen.name}
            </p>
            {detailsOf(chosen) ? (
              <p className="text-sm text-muted" dir="auto">
                {detailsOf(chosen)}
              </p>
            ) : null}
            <p className="text-sm text-muted">Unit: {chosen.unit}</p>
          </div>
        ) : (
          <p className="text-sm text-muted">Choose a medicine above, then type the quantity and press Enter.</p>
        )}
        <div className="flex flex-wrap items-start gap-2">
          <Button variant="secondary" aria-label="Decrease quantity" data-testid="fast-minus" disabled={!chosen || disabled} onClick={() => stepQuantity(-1)} onMouseDown={(e) => e.preventDefault()}>
            <Minus size={18} aria-hidden="true" />
          </Button>
          <div className="min-w-0 flex-1" style={{ minWidth: "5rem" }}>
            <input
              ref={qtyRef}
              data-testid="fast-quantity"
              aria-label="Quantity to add"
              inputMode="numeric"
              pattern="[0-9]*"
              enterKeyHint="done"
              autoComplete="off"
              disabled={!chosen || disabled}
              value={qtyText}
              aria-invalid={qtyError !== null}
              onChange={(e) => {
                setQtyText(e.target.value);
                setQtyError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                }
              }}
              className={inputClass}
            />
          </div>
          <Button variant="secondary" aria-label="Increase quantity" data-testid="fast-plus" disabled={!chosen || disabled} onClick={() => stepQuantity(1)} onMouseDown={(e) => e.preventDefault()}>
            <Plus size={18} aria-hidden="true" />
          </Button>
          <Button data-testid="fast-add" onClick={commit} disabled={!chosen || disabled} onMouseDown={(e) => e.preventDefault()}>
            Add
          </Button>
        </div>
        {chosen ? (
          <div className="flex flex-wrap items-center gap-2">
            {QUICK_QUANTITIES.map((q) => (
              <Button key={q} variant="ghost" data-testid="fast-quick" aria-label={`Set quantity to ${q}`} disabled={disabled} onClick={() => setQtyText(String(q))} onMouseDown={(e) => e.preventDefault()}>
                {q}
              </Button>
            ))}
            <Button variant="ghost" data-testid="fast-cancel" onClick={cancelChoice} onMouseDown={(e) => e.preventDefault()}>
              Cancel
            </Button>
          </div>
        ) : null}
        {qtyError ? (
          <p role="alert" data-testid="fast-quantity-error" className="text-sm text-danger">
            {qtyError}
          </p>
        ) : null}
      </div>

      {list.status === "ready" || list.status === "too_large" || list.status === "error" ? (
        <Button variant="ghost" onClick={list.refresh} data-testid="refresh-medicines">
          <RefreshCw size={18} aria-hidden="true" />
          Refresh medicines
        </Button>
      ) : null}
    </section>
  );
}
