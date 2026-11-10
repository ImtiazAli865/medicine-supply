"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { CancelOrderDialog } from "@/components/orders/CancelOrderDialog";
import { ConfirmOrderDialog } from "@/components/orders/ConfirmOrderDialog";
import { MedicineSearch } from "@/components/orders/MedicineSearch";
import { OrderLineRow } from "@/components/orders/OrderLineRow";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { PendingLineActions } from "@/components/pending/PendingLineActions";
import { OrderTotals } from "@/components/orders/OrderTotals";
import { SaveStatus } from "@/components/orders/SaveStatus";
import { StoreSelector } from "@/components/orders/StoreSelector";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Banner } from "@/components/ui/States";
import { ClientApiError } from "@/lib/api/client";
import { useOrderEditor } from "@/lib/hooks/useOrderEditor";
import { LIMITS, repeatedTypedLineIds } from "@/lib/orders/editor-state";
import { formatOrderNumber } from "@/lib/orders/number";
import type { Order } from "@/lib/orders/types";
import type { Product } from "@/lib/products/types";

function messageOf(error: unknown): string {
  if (error instanceof ClientApiError) {
    if (error.code === "version_conflict") return "This order was changed elsewhere. Review the current order before continuing.";
    return error.fields?.lines ?? error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

/**
 * The order screen. In draft mode (default) every change is saved automatically and the draft can be
 * confirmed. In edit mode (a confirmed order) nothing is saved until "Save changes", which records the
 * whole edit as one entry in the order's change history.
 */
export function OrderEditor({
  orderId,
  initialOrder,
  storeId,
  storeName: initialStoreName,
  mode = "draft",
  onOrderChange,
  onExitEdit,
}: {
  orderId: string;
  /** null for a new order that has not been saved yet. */
  initialOrder: Order | null;
  storeId: string;
  storeName: string;
  mode?: "draft" | "edit";
  onOrderChange: (order: Order) => void;
  /** Edit mode: leave without saving (the saved order is shown again). */
  onExitEdit?: () => void;
}) {
  const router = useRouter();
  const editing = mode === "edit";
  const editor = useOrderEditor({ orderId, initialOrder, storeId, mode });
  const { state, snapshot, info } = editor;

  const [storeName, setStoreName] = useState(initialStoreName);
  const [searchOpen, setSearchOpen] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [focusLine, setFocusLine] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ lineId: string; product: Product } | null>(null);
  const [invalid, setInvalid] = useState<Set<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleValidity = useCallback((id: string, ok: boolean) => {
    setInvalid((prev) => {
      if (ok === !prev.has(id)) return prev;
      const next = new Set(prev);
      if (ok) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Lines that were already on the confirmed order when editing started keep their recorded prices.
  const originalIds = useMemo(() => new Set((initialOrder?.lines ?? []).map((l) => l.id)), [initialOrder]);

  const orderNumber = snapshot.serverOrder?.order_number ?? null;
  const atLineLimit = state.lines.length >= LIMITS.lines;
  const hasLines = state.lines.length > 0;
  const repeated = repeatedTypedLineIds(state, info);
  const unpriced = state.lines.filter((l) => (info[l.id]?.selling_price ?? null) === null).length;
  const notRegistered = state.lines.filter((l) => l.product_id === null).length;
  const conflict = snapshot.status === "changed_elsewhere";
  const canConfirm = hasLines && invalid.size === 0 && !conflict;
  const canSaveChanges = snapshot.isDirty && invalid.size === 0 && !conflict;

  function pickProduct(product: Product) {
    setSearchOpen(false);
    const existing = state.lines.find((l) => l.product_id === product.id);
    if (existing) {
      // Never merge silently: show the existing line and let the person choose.
      setDuplicate({ lineId: existing.id, product });
      setFocusLine(existing.id);
      return;
    }
    setDuplicate(null);
    setFocusLine(editor.addCatalogLine(product));
  }

  function pickTyped(name: string, quantity: number, unit: string) {
    setSearchOpen(false);
    setDuplicate(null);
    setFocusLine(editor.addTypedLine(name, quantity, unit));
  }

  async function confirm() {
    setBusy(true);
    setActionError(null);
    try {
      const order = await editor.confirm();
      setConfirmOpen(false);
      onOrderChange(order);
    } catch (error) {
      setActionError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function discard(reason: string | null) {
    setBusy(true);
    setActionError(null);
    try {
      const order = await editor.discard(reason);
      setDiscardOpen(false);
      if (order) onOrderChange(order);
      else router.push("/orders"); // never saved: there is nothing to cancel
    } catch (error) {
      setActionError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveChanges() {
    setBusy(true);
    setActionError(null);
    try {
      onOrderChange(await editor.saveChanges());
    } catch (error) {
      setActionError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  function discardChanges() {
    if (snapshot.isDirty && !window.confirm("Discard your unsaved changes to this order?")) return;
    editor.revertChanges();
    onExitEdit?.();
  }

  function reviewCurrent() {
    const current = snapshot.conflict;
    if (!current) return;
    if (!window.confirm("Your unsaved changes on this screen will be replaced by the current order. Continue?")) return;
    editor.adoptServerOrder(current);
    setStoreName(current.store.name);
    if (current.status !== (editing ? "confirmed" : "draft")) onOrderChange(current);
    else if (editing) onOrderChange(current);
  }

  return (
    // data-unsaved-guard keeps this screen (and what was typed) on display if the session expires.
    // A div, not a form: the dialogs below contain their own forms, and forms must not be nested.
    <div data-unsaved-guard className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold" data-testid="order-heading">
            {orderNumber ? formatOrderNumber(orderNumber) : "New order"}
          </h1>
          <p className="text-muted" dir="auto" data-testid="order-store">
            Store: <span className="font-medium text-foreground">{storeName}</span>
          </p>
        </div>
        <OrderStatusBadge status={editing ? "confirmed" : "draft"} />
      </div>

      {editing ? (
        <Banner kind="info">
          <p className="font-medium">You are editing a confirmed order.</p>
          <p>Prices already recorded stay as they are. A medicine you add is priced when you save. Nothing is saved until you press Save changes.</p>
        </Banner>
      ) : null}

      {editing && snapshot.status !== "not_saved" && snapshot.status !== "changed_elsewhere" ? (
        <p role="status" aria-live="polite" data-testid="save-status" data-state={snapshot.isDirty ? "unsaved" : "saved"} className="text-muted">
          {snapshot.isDirty ? "You have unsaved changes." : "No unsaved changes."}
        </p>
      ) : (
        <SaveStatus status={snapshot.status} lastSavedAt={snapshot.lastSavedAt} error={snapshot.error} onRetry={editor.retry} onReview={reviewCurrent} />
      )}

      {editing ? null : hasLines ? (
        <p className="text-sm text-muted" data-testid="store-locked-note">
          The store cannot be changed once the order has lines.{" "}
          <Link href="/orders/new" className="inline-flex min-h-11 items-center text-primary underline">
            Start a new order for another store
          </Link>
        </p>
      ) : (
        <Button variant="secondary" onClick={() => setStoreOpen(true)} data-testid="change-store">
          Change store
        </Button>
      )}

      {duplicate ? (
        <Banner kind="info">
          <p className="font-medium">{duplicate.product.name} is already in this order.</p>
          <p>Change the quantity of that line, or add it again as a separate line.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              data-testid="add-separate-line"
              onClick={() => {
                setFocusLine(editor.addCatalogLine(duplicate.product));
                setDuplicate(null);
              }}
            >
              Add as a separate line
            </Button>
            <Button variant="ghost" onClick={() => setDuplicate(null)}>
              Dismiss
            </Button>
          </div>
        </Banner>
      ) : null}

      <section aria-label="Order lines" className="space-y-3">
        {hasLines ? (
          <ul className="space-y-3" data-testid="order-lines">
            {state.lines.map((line) => {
              const isNew = editing && !originalIds.has(line.id);
              return (
                <OrderLineRow
                  key={`${line.id}:${editor.epoch}`}
                  line={line}
                  info={info[line.id]}
                  highlight={duplicate?.lineId === line.id}
                  focusQuantity={focusLine === line.id}
                  repeatedTyped={repeated.has(line.id)}
                  lockName={editing && !isNew}
                  priceNote={isNew ? "Price recorded when you save" : undefined}
                  onChange={(patch) => editor.updateLine(line.id, patch)}
                  onRemove={() => (editing ? setRemoveId(line.id) : editor.removeLine(line.id))}
                  onValidity={handleValidity}
                  actions={
                    line.product_id === null ? (
                      <PendingLineActions
                        orderId={orderId}
                        orderStatus={editing ? "confirmed" : "draft"}
                        line={{ id: line.id, name: info[line.id]?.name ?? line.name ?? "", unit: line.unit, quantity: line.quantity }}
                        getVersion={editor.prepareForPending}
                        onOrderChanged={(order) => editor.adoptServerOrder(order)}
                      />
                    ) : undefined
                  }
                />
              );
            })}
          </ul>
        ) : (
          <p data-testid="no-lines" className="rounded-xl border border-dashed border-border bg-surface px-4 py-6 text-center text-muted">
            No medicines yet. Add the first one.
          </p>
        )}
        <Button className="w-full" onClick={() => setSearchOpen(true)} disabled={atLineLimit} data-testid="add-medicine">
          <Plus size={20} aria-hidden="true" />
          Add medicine
        </Button>
        {atLineLimit ? <p className="text-sm text-warning">An order can have at most {LIMITS.lines} lines. Start a new order for more.</p> : null}
      </section>

      <div>
        <label htmlFor="order-notes" className="mb-1 block text-sm font-medium">
          Order notes (optional)
        </label>
        <textarea
          id="order-notes"
          rows={3}
          maxLength={LIMITS.notes}
          dir="auto"
          value={state.notes}
          onChange={(e) => editor.setNotes(e.target.value)}
          className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base"
        />
      </div>

      <OrderTotals lines={state.lines.map((l) => ({ quantity: l.quantity, selling_price: info[l.id]?.selling_price ?? null }))} />

      {actionError && !confirmOpen && !discardOpen ? <Banner kind="error">{actionError}</Banner> : null}

      {editing ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={saveChanges} loading={busy} disabled={!canSaveChanges || !hasLines} data-testid="save-changes">
            Save changes
          </Button>
          <Button variant="secondary" onClick={discardChanges} disabled={busy} data-testid="discard-changes">
            {snapshot.isDirty ? "Discard changes" : "Close without changes"}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setActionError(null);
                setConfirmOpen(true);
              }}
              disabled={!canConfirm}
              data-testid="confirm-order"
            >
              Confirm order
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setActionError(null);
                setDiscardOpen(true);
              }}
              data-testid="discard-draft"
            >
              Discard draft
            </Button>
          </div>
          {!hasLines ? <p className="text-sm text-muted">Add at least one medicine to confirm the order.</p> : null}
          {hasLines && invalid.size > 0 ? <p className="text-sm text-danger">Fix the highlighted quantities or units before confirming.</p> : null}
        </>
      )}
      {editing && !hasLines ? <p className="text-sm text-muted">A confirmed order must keep at least one line. To remove the whole order, cancel it instead.</p> : null}

      <MedicineSearch open={searchOpen} onClose={() => setSearchOpen(false)} onPickProduct={pickProduct} onPickTyped={pickTyped} />

      <Dialog open={storeOpen} title="Change store" onClose={() => setStoreOpen(false)}>
        <StoreSelector
          onSelect={(store) => {
            setStoreOpen(false);
            if (snapshot.version === null) {
              // Nothing was saved yet, so nothing needs to move: start over with the other store.
              router.replace(`/orders/${orderId}?store=${store.id}`);
            } else {
              setStoreName(store.name);
              editor.setStore(store.id);
            }
          }}
        />
        <Button variant="ghost" className="w-full" onClick={() => setStoreOpen(false)}>
          Close
        </Button>
      </Dialog>

      <Dialog open={removeId !== null} title="Remove this line?" onClose={() => setRemoveId(null)}>
        <p>The line is removed from the order and recorded in the change history when you save.</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="danger"
            data-testid="remove-line-yes"
            onClick={() => {
              if (removeId) editor.removeLine(removeId);
              setRemoveId(null);
            }}
          >
            Remove line
          </Button>
          <Button variant="secondary" onClick={() => setRemoveId(null)}>
            Keep it
          </Button>
        </div>
      </Dialog>

      <ConfirmOrderDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirm}
        busy={busy}
        error={actionError}
        lineCount={state.lines.length}
        notRegisteredCount={notRegistered}
        unpricedCount={unpriced}
      />
      <CancelOrderDialog open={discardOpen} mode="draft" onClose={() => setDiscardOpen(false)} onConfirm={discard} busy={busy} error={actionError} />
    </div>
  );
}
