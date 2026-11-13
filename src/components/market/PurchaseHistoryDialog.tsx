"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Banner, EmptyState, ErrorState } from "@/components/ui/States";
import { LoadingBlock } from "@/components/ui/Spinner";
import { ClientApiError } from "@/lib/api/client";
import { getPurchases, postVoid } from "@/lib/market/client";
import type { MarketRow, PurchaseEntries, PurchaseEntry } from "@/lib/market/types";
import { formatPakistanDateTime } from "@/lib/orders/dates";
import { ClipboardList } from "lucide-react";

interface Props {
  open: boolean;
  row: MarketRow;
  date: string;
  onClose: () => void;
  /** Called after an entry was cancelled, so the list can reload its totals. */
  onChanged: () => void;
}

/**
 * The purchase history of one medicine, unit and day, cancelled entries included. Entries are never edited or
 * deleted: a wrong entry is cancelled with a reason and a corrected entry is recorded. The unit cost shown here
 * is what the supplier typed; it never appears on the list, the print or the export.
 */
export function PurchaseHistoryDialog({ open, row, date, onClose, onChanged }: Props) {
  return (
    <Dialog open={open} title={`Purchases: ${row.name ?? ""}`} onClose={onClose}>
      <HistoryBody row={row} date={date} onClose={onClose} onChanged={onChanged} />
    </Dialog>
  );
}

type Loaded = { key: number; data?: PurchaseEntries; error?: string };

function HistoryBody({ row, date, onClose, onChanged }: Omit<Props, "open">) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [cancelling, setCancelling] = useState<PurchaseEntry | null>(null);

  useEffect(() => {
    let alive = true;
    getPurchases(row.product_id ?? "", row.unit, date)
      .then((data) => alive && setLoaded({ key: attempt, data }))
      .catch((e: unknown) => alive && setLoaded({ key: attempt, error: e instanceof ClientApiError ? e.message : "Something went wrong. Please try again." }));
    return () => {
      alive = false;
    };
  }, [attempt, row.product_id, row.unit, date]);

  const current = loaded?.key === attempt ? loaded : null;

  return (
    <div className="space-y-4" data-testid="purchase-history">
      {!current ? (
        <LoadingBlock label="Loading purchases…" />
      ) : current.error || !current.data ? (
        <ErrorState message={current.error ?? "Something went wrong. Please try again."} onRetry={() => setAttempt((n) => n + 1)} />
      ) : current.data.entries.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No purchases recorded yet" description="Record the first purchase from the list." />
      ) : (
        <>
          <p className="text-sm text-muted">
            Bought {current.data.purchased} of {current.data.requested} {row.unit}
          </p>
          <ul className="space-y-2">
            {current.data.entries.map((entry) => (
              <li key={entry.id} data-testid="purchase-entry" data-cancelled={entry.cancelled} className="space-y-1 rounded-lg border border-border p-3">
                <p className={`font-medium ${entry.cancelled ? "text-muted line-through" : ""}`}>
                  {entry.quantity} {entry.unit}
                  {entry.unit_cost ? ` at PKR ${entry.unit_cost}` : ""}
                </p>
                <p className="text-sm text-muted">
                  {formatPakistanDateTime(entry.created_at)} · {entry.recorded_by_me ? "You" : "Another user"}
                  {entry.supplier_name ? ` · ${entry.supplier_name}` : ""}
                  {entry.reference ? ` · ${entry.reference}` : ""}
                </p>
                {entry.cancelled && entry.void ? (
                  <p className="text-sm text-danger" data-testid="purchase-void-reason">
                    Cancelled by {entry.void.by_me ? "You" : "another user"} on {formatPakistanDateTime(entry.void.voided_at)}: {entry.void.reason}
                  </p>
                ) : (
                  <Button variant="secondary" onClick={() => setCancelling(entry)} data-testid="cancel-entry">
                    Cancel entry
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {cancelling ? (
        <CancelEntryForm
          entry={cancelling}
          onBack={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            setAttempt((n) => n + 1);
            onChanged();
          }}
        />
      ) : null}

      <div className="flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

function CancelEntryForm({ entry, onBack, onDone }: { entry: PurchaseEntry; onBack: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setFailure(null);
    if (reason.trim() === "") {
      setError("Write why this entry is cancelled.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await postVoid(entry.id, reason.trim());
      onDone();
    } catch (e) {
      if (e instanceof ClientApiError && e.fields?.reason) setError(e.fields.reason);
      else setFailure(e instanceof ClientApiError ? e.message : "The entry was not cancelled. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-lg border border-danger/30 bg-danger-soft p-3" data-testid="cancel-entry-form" data-unsaved-guard>
      <p className="font-medium">
        Cancel the entry of {entry.quantity} {entry.unit}?
      </p>
      <p className="text-sm">It stays in the history, marked cancelled, and no longer counts as bought.</p>
      <Field id="cancel-reason" label="Reason" required error={error ?? undefined}>
        <textarea
          id="cancel-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={500}
          className="block min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base"
        />
      </Field>
      {failure ? <Banner kind="error">{failure}</Banner> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onBack} disabled={saving}>
          Keep entry
        </Button>
        <Button type="submit" variant="danger" loading={saving} data-testid="confirm-cancel-entry">
          Cancel entry
        </Button>
      </div>
    </form>
  );
}
