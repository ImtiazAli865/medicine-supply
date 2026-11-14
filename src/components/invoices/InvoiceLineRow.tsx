"use client";

import { Minus, Plus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { formatInvoiceMoney, MAX_DELIVERED_QUANTITY } from "@/lib/invoices/status";
import type { InvoiceLine } from "@/lib/invoices/types";

/** The whole number a quantity text stands for, or null when it is not a whole number from 0 to the maximum. */
export function parseDelivered(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= MAX_DELIVERED_QUANTITY ? value : null;
}

function details(line: InvoiceLine): string {
  return [line.strength, line.dosage_form, line.pack_size, line.manufacturer].filter((part): part is string => Boolean(part)).join(" · ");
}

/**
 * One line of a draft invoice. The ordered quantity is shown and never changes; the delivered (billed) quantity can
 * be changed. The line total shown is the one the server calculated for the saved quantity.
 */
export function InvoiceLineRow({
  line,
  value,
  onChange,
  error,
  disabled,
}: {
  line: InvoiceLine;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  const current = parseDelivered(value);
  const step = (delta: number) => {
    const base = current ?? line.delivered_quantity;
    onChange(String(Math.min(MAX_DELIVERED_QUANTITY, Math.max(0, base + delta))));
  };
  const inputId = `delivered-${line.id}`;
  return (
    <li data-testid="invoice-line" data-line-id={line.id} className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div>
        <p className="font-medium" dir="auto" data-testid="invoice-line-name">
          {line.name}
        </p>
        {details(line) ? (
          <p className="text-sm text-muted" dir="auto">
            {details(line)}
          </p>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-2">
          {line.typed ? <Badge tone="warning">Not registered</Badge> : null}
          {line.needs_price ? <Badge tone="danger">Needs a verified selling price</Badge> : null}
          {!line.billed ? <Badge>Not delivered, not billed</Badge> : null}
          {line.more_than_ordered ? <Badge tone="warning">More than ordered</Badge> : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <p className="text-sm text-muted" data-testid="invoice-line-ordered">
          Ordered: <span className="font-medium text-foreground">{line.ordered_quantity.toLocaleString("en-US")}</span> {line.unit}
        </p>
        <div>
          <label htmlFor={inputId} className="mb-1 block text-sm font-medium">
            Delivered ({line.unit})
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={`Decrease delivered quantity of ${line.name}`}
              onClick={() => step(-1)}
              disabled={disabled || (current ?? line.delivered_quantity) <= 0}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-surface disabled:opacity-50"
            >
              <Minus size={18} aria-hidden="true" />
            </button>
            <input
              id={inputId}
              data-testid="delivered-input"
              inputMode="numeric"
              autoComplete="off"
              value={value}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${inputId}-error` : undefined}
              className={`min-h-11 w-24 rounded-lg border bg-surface px-3 py-2 text-center text-base ${error ? "border-danger" : "border-border"}`}
            />
            <button
              type="button"
              aria-label={`Increase delivered quantity of ${line.name}`}
              onClick={() => step(1)}
              disabled={disabled || (current ?? line.delivered_quantity) >= MAX_DELIVERED_QUANTITY}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-surface disabled:opacity-50"
            >
              <Plus size={18} aria-hidden="true" />
            </button>
          </div>
          {error ? (
            <p id={`${inputId}-error`} role="alert" className="mt-1 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border pt-2 text-sm">
        <span data-testid="invoice-line-price">
          Selling price: <span className="font-medium">{formatInvoiceMoney(line.selling_price)}</span>
        </span>
        <span data-testid="invoice-line-total" className="text-base font-semibold">
          {line.billed ? formatInvoiceMoney(line.line_total) : "Not billed"}
        </span>
      </div>
    </li>
  );
}
