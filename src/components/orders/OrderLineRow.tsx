"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatPKR } from "@/lib/money";
import { cleanTypedName, LIMITS, parseQuantity, type LineInfo } from "@/lib/orders/editor-state";
import { lineTotal } from "@/lib/orders/totals";
import type { OrderLineInput } from "@/lib/orders/types";

const inputClass = "min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base";

/** One order line: the medicine, its quantity and unit, and its price. Read-only when `readOnly`. */
export function OrderLineRow({
  line,
  info,
  highlight = false,
  focusQuantity = false,
  readOnly = false,
  repeatedTyped = false,
  lockName = false,
  onChange,
  onRemove,
  onValidity,
  priceNote,
}: {
  line: OrderLineInput;
  info: LineInfo | undefined;
  highlight?: boolean;
  focusQuantity?: boolean;
  readOnly?: boolean;
  repeatedTyped?: boolean;
  /** A typed line on a confirmed order: its recorded name can no longer be edited. */
  lockName?: boolean;
  onChange?: (patch: Partial<Pick<OrderLineInput, "quantity" | "unit" | "name">>) => void;
  onRemove?: () => void;
  onValidity?: (lineId: string, ok: boolean) => void;
  /** Replaces the price line, for example "Price recorded when you save" on a line added to a confirmed order. */
  priceNote?: string;
}) {
  const name = info?.name ?? line.name ?? "Medicine";
  const typed = line.product_id === null;

  // What the person typed may be invalid for a moment (empty, 0); the order keeps the last valid value.
  const [qtyText, setQtyText] = useState(String(line.quantity));
  const [unitText, setUnitText] = useState(line.unit);
  const [nameText, setNameText] = useState(name);
  const qtyError = parseQuantity(qtyText) === null ? `Quantity must be a whole number from 1 to ${LIMITS.quantityMax.toLocaleString("en-US")}.` : null;
  const unitError = unitText.trim() === "" ? "Enter a unit." : unitText.trim().length > LIMITS.unit ? `Unit can be at most ${LIMITS.unit} characters.` : null;
  const nameEditable = typed && !readOnly && !lockName;
  const nameError = nameEditable ? (cleanTypedName(nameText) === "" ? "Enter the medicine name." : cleanTypedName(nameText).length > LIMITS.name ? `Name can be at most ${LIMITS.name} characters.` : null) : null;
  const invalid = Boolean(qtyError || unitError || nameError);

  useEffect(() => {
    onValidity?.(line.id, !invalid);
  }, [invalid, line.id, onValidity]);
  useEffect(() => () => onValidity?.(line.id, true), [line.id, onValidity]);

  const qtyRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusQuantity) {
      qtyRef.current?.focus();
      qtyRef.current?.select();
    }
  }, [focusQuantity]);

  const details = [info?.strength, info?.dosage_form, info?.pack_size, info?.manufacturer].filter(Boolean).join(" · ");
  const price = info?.selling_price ?? null;
  const total = lineTotal(line.quantity, price);

  return (
    <li
      data-testid="order-line"
      data-line-id={line.id}
      className={`space-y-3 rounded-xl border bg-surface p-3 ${highlight ? "border-primary ring-2 ring-primary-soft" : "border-border"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {nameEditable ? null : (
            <p className="font-semibold" dir="auto" data-testid="line-name">
              {name}
            </p>
          )}
          {details ? (
            <p className="text-sm text-muted" dir="auto">
              {details}
            </p>
          ) : null}
        </div>
        {!readOnly && onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${name}`}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-danger hover:bg-danger-soft"
          >
            <Trash2 size={20} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {typed ? <Badge tone="warning">Not registered</Badge> : null}
        {price === null ? <Badge tone="warning">No selling price</Badge> : null}
      </div>

      {nameEditable ? (
        <div>
          <label htmlFor={`name-${line.id}`} className="mb-1 block text-sm font-medium">
            Medicine name
          </label>
          <input
            id={`name-${line.id}`}
            value={nameText}
            maxLength={LIMITS.name + 20}
            dir="auto"
            className={inputClass}
            onChange={(e) => {
              setNameText(e.target.value);
              if (cleanTypedName(e.target.value) !== "") onChange?.({ name: e.target.value });
            }}
          />
          {nameError ? <p role="alert" className="mt-1 text-sm text-danger">{nameError}</p> : null}
        </div>
      ) : null}

      {readOnly ? (
        <p data-testid="line-qty-unit">
          <span className="font-medium">{line.quantity.toLocaleString("en-US")}</span> {line.unit}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`qty-${line.id}`} className="mb-1 block text-sm font-medium">
              Quantity
            </label>
            <input
              ref={qtyRef}
              id={`qty-${line.id}`}
              inputMode="numeric"
              pattern="[0-9]*"
              value={qtyText}
              aria-invalid={qtyError ? true : undefined}
              className={inputClass}
              onChange={(e) => {
                setQtyText(e.target.value);
                const parsed = parseQuantity(e.target.value);
                if (parsed !== null) onChange?.({ quantity: parsed });
              }}
            />
          </div>
          <div>
            <label htmlFor={`unit-${line.id}`} className="mb-1 block text-sm font-medium">
              Unit
            </label>
            <input
              id={`unit-${line.id}`}
              value={unitText}
              maxLength={LIMITS.unit + 10}
              aria-invalid={unitError ? true : undefined}
              className={inputClass}
              onChange={(e) => {
                setUnitText(e.target.value);
                if (e.target.value.trim() !== "" && e.target.value.trim().length <= LIMITS.unit) onChange?.({ unit: e.target.value });
              }}
            />
          </div>
        </div>
      )}
      {qtyError && !readOnly ? <p role="alert" className="text-sm text-danger">{qtyError}</p> : null}
      {unitError && !readOnly ? <p role="alert" className="text-sm text-danger">{unitError}</p> : null}

      {priceNote ? (
        <p className="text-sm text-muted">{priceNote}</p>
      ) : price !== null ? (
        <p className="text-sm" data-testid="line-price">
          <span className="text-muted">{info?.price_basis === "current" ? "Current price " : "Price "}</span>
          {formatPKR(price)}
          {total ? (
            <>
              <span className="text-muted"> · Line total </span>
              <span className="font-medium" data-testid="line-total">{formatPKR(total)}</span>
            </>
          ) : null}
        </p>
      ) : null}

      {repeatedTyped ? (
        <p role="status" className="text-sm text-warning" data-testid="repeated-typed-warning">
          This typed name is also on another line of this order. Both are kept; remove one if it is a repeat.
        </p>
      ) : null}
    </li>
  );
}
