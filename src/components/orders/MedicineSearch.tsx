"use client";

import { Pill, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/States";
import { LoadingBlock } from "@/components/ui/Spinner";
import { cleanTypedName, LIMITS, parseQuantity } from "@/lib/orders/editor-state";
import { useSearchList } from "@/lib/hooks/useSearchList";
import { COMMON_UNITS, type Product } from "@/lib/products/types";

const inputClass = "min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base";

function ProductResult({ product, onPick }: { product: Product; onPick: (p: Product) => void }) {
  const details = [product.strength, product.dosage_form, product.pack_size, product.manufacturer].filter(Boolean).join(" · ");
  return (
    <li>
      <button
        type="button"
        data-testid="medicine-result"
        onClick={() => onPick(product)}
        className="flex min-h-14 w-full flex-col items-start gap-0.5 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:border-primary"
      >
        <span className="font-semibold" dir="auto">
          {product.name}
        </span>
        {details ? (
          <span className="text-sm text-muted" dir="auto">
            {details}
          </span>
        ) : null}
        <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
          Unit: {product.unit}
          {product.selling_price === null ? <Badge tone="warning">No selling price</Badge> : null}
        </span>
      </button>
    </li>
  );
}

function TypedForm({
  initialName,
  onBack,
  onAdd,
}: {
  initialName: string;
  onBack: () => void;
  onAdd: (name: string, quantity: number, unit: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const cleanName = cleanTypedName(name);
  const qty = parseQuantity(quantity);
  const errors = {
    name: cleanName === "" ? "Enter the medicine name." : cleanName.length > LIMITS.name ? `Name can be at most ${LIMITS.name} characters.` : null,
    quantity: qty === null ? `Quantity must be a whole number from 1 to ${LIMITS.quantityMax.toLocaleString("en-US")}.` : null,
    unit: unit.trim() === "" ? "Enter a unit." : unit.trim().length > LIMITS.unit ? `Unit can be at most ${LIMITS.unit} characters.` : null,
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (errors.name || errors.quantity || errors.unit || qty === null) return;
        onAdd(cleanName, qty, unit.trim());
      }}
    >
      <p className="text-sm text-muted">
        This medicine is not in your catalog. It is added to the order exactly as you type it and marked &ldquo;Not registered&rdquo;. It never blocks the order.
      </p>
      <div>
        <label htmlFor="typed-name" className="mb-1 block text-sm font-medium">
          Medicine name
        </label>
        <input id="typed-name" value={name} dir="auto" onChange={(e) => setName(e.target.value)} className={inputClass} />
        {submitted && errors.name ? <p role="alert" className="mt-1 text-sm text-danger">{errors.name}</p> : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="typed-qty" className="mb-1 block text-sm font-medium">
            Quantity
          </label>
          <input id="typed-qty" inputMode="numeric" pattern="[0-9]*" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
          {submitted && errors.quantity ? <p role="alert" className="mt-1 text-sm text-danger">{errors.quantity}</p> : null}
        </div>
        <div>
          <label htmlFor="typed-unit" className="mb-1 block text-sm font-medium">
            Unit
          </label>
          <input id="typed-unit" list="typed-units" value={unit} placeholder="strip, box…" onChange={(e) => setUnit(e.target.value)} className={inputClass} />
          <datalist id="typed-units">
            {COMMON_UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
          {submitted && errors.unit ? <p role="alert" className="mt-1 text-sm text-danger">{errors.unit}</p> : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" data-testid="add-typed-line">
          Add to order
        </Button>
        <Button variant="secondary" onClick={onBack}>
          Back to search
        </Button>
      </div>
    </form>
  );
}

function Panel({
  onPickProduct,
  onPickTyped,
}: {
  onPickProduct: (product: Product) => void;
  onPickTyped: (name: string, quantity: number, unit: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [typing, setTyping] = useState(false);
  const list = useSearchList<Product>("/api/products", query, "active");

  if (typing) {
    return <TypedForm initialName={cleanTypedName(query)} onBack={() => setTyping(false)} onAdd={onPickTyped} />;
  }

  const hasText = query.trim() !== "";
  const catalogEmpty = !list.loading && !list.error && list.items.length === 0 && list.activeQuery === "";

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          type="search"
          autoFocus
          aria-label="Search medicines"
          placeholder="Name, strength, form, maker or code"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          dir="auto"
          className="min-h-11 w-full rounded-lg border border-border bg-surface py-2 pl-10 pr-3 text-base"
        />
      </div>

      <div className="max-h-[55vh] space-y-2 overflow-y-auto" data-testid="medicine-results">
        {list.error && list.items.length === 0 ? (
          <ErrorState message={list.error} onRetry={list.retry} />
        ) : list.loading && list.items.length === 0 ? (
          <LoadingBlock label="Searching…" />
        ) : catalogEmpty ? (
          <div data-testid="catalog-empty" className="space-y-2 rounded-xl border border-dashed border-border p-4 text-center">
            <Pill size={32} className="mx-auto text-primary" aria-hidden="true" />
            <p className="font-medium">Your catalog is empty.</p>
            <p className="text-sm text-muted">Type the medicine name below to add it as typed, or add or import medicines first.</p>
            <p className="flex flex-wrap justify-center gap-3 text-sm">
              <Link href="/products/new" className="inline-flex min-h-11 items-center text-primary underline">Add a medicine</Link>
              <Link href="/products/import" className="inline-flex min-h-11 items-center text-primary underline">Import a list</Link>
            </p>
          </div>
        ) : list.items.length === 0 ? (
          <p data-testid="no-matching-medicine" className="rounded-lg bg-slate-100 px-3 py-3 text-center text-muted">
            No matching medicine.
          </p>
        ) : (
          <ul className="space-y-2">
            {list.items.map((p) => (
              <ProductResult key={p.id} product={p} onPick={onPickProduct} />
            ))}
          </ul>
        )}
        {list.hasMore ? (
          <Button variant="secondary" className="w-full" onClick={list.loadMore} loading={list.loadingMore}>
            Show more
          </Button>
        ) : null}
      </div>

      {hasText || catalogEmpty ? (
        <Button variant="secondary" className="w-full" data-testid="add-as-typed" onClick={() => setTyping(true)}>
          {list.items.length === 0 && !list.loading && hasText
            ? `Add as typed: “${cleanTypedName(query)}”`
            : "None of these, it is a new medicine"}
        </Button>
      ) : null}
    </div>
  );
}

/** Searchable medicine picker in a dialog, with the typed (not registered) paths. Nothing is ever auto-selected. */
export function MedicineSearch({
  open,
  onClose,
  onPickProduct,
  onPickTyped,
}: {
  open: boolean;
  onClose: () => void;
  onPickProduct: (product: Product) => void;
  onPickTyped: (name: string, quantity: number, unit: string) => void;
}) {
  return (
    <Dialog open={open} title="Add medicine" onClose={onClose}>
      <Panel onPickProduct={onPickProduct} onPickTyped={onPickTyped} />
      <Button variant="ghost" className="w-full" onClick={onClose}>
        Close
      </Button>
    </Dialog>
  );
}
