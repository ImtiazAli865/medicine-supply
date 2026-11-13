"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/Field";
import { Banner } from "@/components/ui/States";
import { ClientApiError } from "@/lib/api/client";
import { newId } from "@/lib/ids";
import { postPurchase } from "@/lib/market/client";
import { formatDay } from "@/lib/market/status";
import type { MarketRow, PurchaseEntry } from "@/lib/market/types";
import { today as todayPakistan, RecordPurchaseBodySchema } from "@/lib/validation/market";

interface Props {
  open: boolean;
  row: MarketRow;
  /** The list date: the purchase date starts here. */
  date: string;
  onClose: () => void;
  onSaved: (entry: PurchaseEntry, purchaseDate: string) => void;
}

/**
 * Record one real purchase. The quantity is the only way to mark something bought: "Bought all remaining" only
 * fills the field with the remaining quantity and saves nothing. The entry id is created once for the dialog, so
 * a double tap or a retry repeats the same request and never creates a second entry.
 */
export function RecordPurchaseDialog({ open, row, date, onClose, onSaved }: Props) {
  return (
    <Dialog open={open} title={`Record purchase: ${row.name ?? ""}`} onClose={onClose}>
      <RecordPurchaseForm row={row} date={date} onClose={onClose} onSaved={onSaved} />
    </Dialog>
  );
}

function RecordPurchaseForm({ row, date, onClose, onSaved }: Omit<Props, "open">) {
  const [entryId] = useState(() => newId());
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(date);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const todayDay = todayPakistan();

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setFailure(null);
    const digits = quantity.trim();
    const parsed = RecordPurchaseBodySchema().safeParse({
      id: entryId,
      product_id: row.product_id,
      unit: row.unit,
      purchase_date: purchaseDate,
      quantity: /^\d{1,7}$/.test(digits) ? Number(digits) : Number.NaN,
      unit_cost: cost,
      supplier_name: supplier,
      reference,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "_");
        if (!(key in next)) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const result = await postPurchase(parsed.data);
      onSaved(result.entry, purchaseDate);
    } catch (error) {
      if (error instanceof ClientApiError && error.fields) {
        setErrors(error.fields);
      } else {
        // Keep everything the supplier typed; a retry sends the same entry id, so it can never be recorded twice.
        setFailure(error instanceof ClientApiError ? error.message : "The purchase was not saved. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  const differentDay = purchaseDate !== date;

  return (
    <form onSubmit={save} noValidate className="space-y-4" data-testid="record-purchase-form" data-unsaved-guard>
      <p className="text-sm text-muted" data-testid="record-purchase-summary">
        Requested {row.total_requested} {row.unit} · bought {row.purchased} · remaining {row.remaining}
      </p>

      <div className="space-y-2">
        <TextInput
          id="purchase-quantity"
          label={`Quantity bought (${row.unit})`}
          required
          inputMode="numeric"
          autoComplete="off"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          error={errors.quantity}
        />
        {row.remaining > 0 ? (
          <Button variant="secondary" onClick={() => setQuantity(String(row.remaining))} data-testid="bought-all-remaining">
            Bought all remaining ({row.remaining})
          </Button>
        ) : null}
      </div>

      <TextInput
        id="purchase-cost"
        label="Cost per unit in PKR (optional)"
        inputMode="decimal"
        autoComplete="off"
        value={cost}
        onChange={(e) => setCost(e.target.value)}
        error={errors.unit_cost}
        hint="Only you see this cost. It is never printed or exported on the market list."
      />
      <TextInput id="purchase-supplier" label="Supplier or market (optional)" value={supplier} onChange={(e) => setSupplier(e.target.value)} error={errors.supplier_name} />
      <TextInput id="purchase-reference" label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} error={errors.reference} />
      <TextInput
        id="purchase-date"
        label="Purchase date"
        type="date"
        value={purchaseDate}
        max={todayDay}
        onChange={(e) => e.target.value && setPurchaseDate(e.target.value)}
        error={errors.purchase_date}
      />
      {differentDay ? (
        <Banner kind="warning">
          This purchase will count for {formatDay(purchaseDate)}, not for {formatDay(date)}.
        </Banner>
      ) : null}

      {failure ? <Banner kind="error">{failure}</Banner> : null}
      {errors.id || errors.product_id || errors.unit ? <Banner kind="error">{errors.id ?? errors.product_id ?? errors.unit}</Banner> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving} data-testid="save-purchase">
          Save purchase
        </Button>
      </div>
    </form>
  );
}
