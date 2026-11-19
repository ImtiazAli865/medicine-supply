"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { cleanTypedName, LIMITS, parseQuantity } from "@/lib/orders/editor-state";
import { COMMON_UNITS } from "@/lib/products/types";

const inputClass = "min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base";

/**
 * The typed (not registered) path, inline on the order screen: the name is kept exactly as typed, with a quantity and a unit.
 * It never blocks an order (Principle IV). The same checks as the line editor: whole quantity 1 to 100,000, unit up to 50 characters.
 */
export function TypedLineForm({
  initialName,
  onCancel,
  onAdd,
}: {
  initialName: string;
  onCancel: () => void;
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
      className="space-y-3 rounded-xl border border-border bg-surface p-3"
      data-testid="typed-form"
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
        {submitted && errors.name ? (
          <p role="alert" className="mt-1 text-sm text-danger">
            {errors.name}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="typed-qty" className="mb-1 block text-sm font-medium">
            Quantity
          </label>
          <input id="typed-qty" inputMode="numeric" pattern="[0-9]*" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
          {submitted && errors.quantity ? (
            <p role="alert" className="mt-1 text-sm text-danger">
              {errors.quantity}
            </p>
          ) : null}
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
          {submitted && errors.unit ? (
            <p role="alert" className="mt-1 text-sm text-danger">
              {errors.unit}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" data-testid="add-typed-line">
          Add to order
        </Button>
        <Button variant="secondary" onClick={onCancel} data-testid="typed-cancel">
          Back to search
        </Button>
      </div>
    </form>
  );
}
