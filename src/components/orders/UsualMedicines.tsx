"use client";

import { Check, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { LoadingBlock } from "@/components/ui/Spinner";
import { LIMITS, parseQuantity } from "@/lib/orders/editor-state";
import type { UsualMedicine } from "@/lib/orders/fast-types";

export const QUICK_QUANTITIES = [5, 10, 20, 50] as const;
const FIRST_SHOWN = 6;

function details(medicine: UsualMedicine["medicine"]): string {
  return [medicine.strength, medicine.dosage_form, medicine.pack_size, medicine.manufacturer].filter(Boolean).join(" · ");
}

const rangeText = `Quantity must be a whole number from 1 to ${LIMITS.quantityMax.toLocaleString("en-US")}.`;

function UsualCard({
  item,
  onOrder,
  disabled,
  onAdd,
}: {
  item: UsualMedicine;
  onOrder: boolean;
  disabled: boolean;
  onAdd: (item: UsualMedicine, quantity: number, unit: string) => void;
}) {
  // What is typed may be invalid for a moment; the add button waits for a whole number from 1 to 100,000.
  const [text, setText] = useState(String(item.last_quantity));
  const quantity = parseQuantity(text);
  const info = details(item.medicine);

  function step(delta: number) {
    const base = quantity ?? item.last_quantity;
    setText(String(Math.min(LIMITS.quantityMax, Math.max(1, base + delta))));
  }

  return (
    <li data-testid="usual-card" className="space-y-2 rounded-xl border border-border bg-surface p-3">
      <div>
        <p className="font-semibold" dir="auto" data-testid="usual-name">
          {item.medicine.name}
        </p>
        {info ? (
          <p className="text-sm text-muted" dir="auto" data-testid="usual-details">
            {info}
          </p>
        ) : null}
        <p className="text-sm text-muted" data-testid="usual-last">
          Last time: {item.last_quantity} {item.last_unit}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" aria-label={`Decrease quantity of ${item.medicine.name}`} data-testid="usual-minus" onClick={() => step(-1)} disabled={disabled}>
          <Minus size={18} aria-hidden="true" />
        </Button>
        <input
          aria-label={`Quantity of ${item.medicine.name}`}
          data-testid="usual-quantity"
          inputMode="numeric"
          pattern="[0-9]*"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={quantity === null}
          className="min-h-11 w-20 rounded-lg border border-border bg-surface px-3 py-2 text-center text-base"
        />
        <Button variant="secondary" aria-label={`Increase quantity of ${item.medicine.name}`} data-testid="usual-plus" onClick={() => step(1)} disabled={disabled}>
          <Plus size={18} aria-hidden="true" />
        </Button>
        {QUICK_QUANTITIES.map((q) => (
          <Button key={q} variant="ghost" aria-label={`Set quantity of ${item.medicine.name} to ${q}`} data-testid="usual-quick" onClick={() => setText(String(q))} disabled={disabled}>
            {q}
          </Button>
        ))}
      </div>
      {quantity === null ? (
        <p role="alert" className="text-sm text-danger">
          {rangeText}
        </p>
      ) : null}

      <Button
        className="w-full"
        variant={onOrder ? "secondary" : "primary"}
        data-testid="usual-add"
        data-on-order={onOrder ? "true" : "false"}
        disabled={disabled || quantity === null}
        onClick={() => quantity !== null && onAdd(item, quantity, item.last_unit)}
      >
        {onOrder ? <Check size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
        {onOrder ? "On order · add again" : `Add ${quantity ?? ""} ${item.last_unit}`.replace(/\s+/g, " ").trim()}
      </Button>
    </li>
  );
}

/**
 * The store's usual medicines, one card each. One tap adds one line with the quantity and unit on the card
 * (changeable first with the stepper or the quick buttons). Nothing is added or preselected without a tap.
 */
export function UsualMedicines({
  usual,
  hasHistory,
  loading,
  error,
  onRetry,
  onOrderIds,
  disabled,
  onAdd,
}: {
  usual: UsualMedicine[];
  /** True when the store has at least one confirmed order. */
  hasHistory: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** Ids of the medicines already on the order (the card shows "On order"). */
  onOrderIds: ReadonlySet<string>;
  disabled: boolean;
  onAdd: (item: UsualMedicine, quantity: number, unit: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  if (loading) return <LoadingBlock label="Loading usual medicines…" />;
  if (error) return <ErrorState message={`The usual medicines of this store could not be loaded. ${error}`} onRetry={onRetry} />;

  if (usual.length === 0) {
    return (
      <p data-testid="usual-empty" className="rounded-xl border border-dashed border-border bg-surface px-4 py-3 text-sm text-muted">
        {hasHistory
          ? "No usual medicines yet for this store in the last 180 days. Search for a medicine above."
          : "Frequent medicines of this store appear here after its first confirmed orders. Search for a medicine above."}
      </p>
    );
  }

  const shown = showAll ? usual : usual.slice(0, FIRST_SHOWN);
  return (
    <section aria-label="Usual medicines" className="space-y-2" data-testid="usual-section">
      <h2 className="text-base font-semibold">Usual medicines of this store</h2>
      <ul className="space-y-2">
        {shown.map((item) => (
          <UsualCard key={item.medicine.id} item={item} onOrder={onOrderIds.has(item.medicine.id)} disabled={disabled} onAdd={onAdd} />
        ))}
      </ul>
      {usual.length > FIRST_SHOWN ? (
        <Button variant="secondary" className="w-full" data-testid="usual-show-all" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${usual.length}`}
        </Button>
      ) : null}
    </section>
  );
}
