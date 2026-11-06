"use client";

import { ChevronLeft, FileQuestion, Pencil } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CancelOrderDialog } from "@/components/orders/CancelOrderDialog";
import { OrderEditor } from "@/components/orders/OrderEditor";
import { OrderHistoryLog } from "@/components/orders/OrderHistoryLog";
import { OrderView } from "@/components/orders/OrderView";
import { Button, ButtonLink } from "@/components/ui/Button";
import { LoadingBlock } from "@/components/ui/Spinner";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import { newId } from "@/lib/ids";
import type { Order, OrderResult } from "@/lib/orders/types";
import type { Store } from "@/lib/stores/types";

type Load =
  | { kind: "error"; message: string }
  | { kind: "missing" }
  | { kind: "ready"; order: Order }
  | { kind: "new"; storeName: string; storeId: string };

/** Edit and Cancel for a confirmed order. A cancelled order offers neither. */
function ConfirmedActions({ order, onEdit, onCancelled }: { order: Order; onEdit: () => void; onCancelled: (order: Order) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel(reason: string | null) {
    setBusy(true);
    setError(null);
    try {
      const { data } = await fetchJson<OrderResult>(`/api/orders/${order.id}/cancel`, {
        json: { request_id: newId(), expected_version: order.version, reason },
      });
      setOpen(false);
      onCancelled(data.order);
    } catch (e) {
      setError(
        e instanceof ClientApiError
          ? e.code === "version_conflict"
            ? "This order was changed elsewhere. Reload it before cancelling."
            : (e.fields?.reason ?? e.message)
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={onEdit} data-testid="edit-order">
        <Pencil size={18} aria-hidden="true" />
        Edit order
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        data-testid="cancel-order"
      >
        Cancel order
      </Button>
      <CancelOrderDialog open={open} mode="confirmed" onClose={() => setOpen(false)} onConfirm={cancel} busy={busy} error={error} />
    </div>
  );
}

/**
 * Loads the order at this address and shows the right screen: an editor for a draft or a not-yet-saved new
 * order (the address carries ?store=), a read-only view with Edit and Cancel for a confirmed order, and a
 * read-only view for a cancelled one.
 */
export function OrderScreen({ id, storeParam }: { id: string; storeParam: string | null }) {
  const [attempt, setAttempt] = useState(0);
  const key = `${id}|${storeParam ?? ""}|${attempt}`;
  const [result, setResult] = useState<{ key: string; load: Load } | null>(null);
  // An order changed on this screen (confirmed, edited, cancelled) replaces what was loaded.
  const [override, setOverride] = useState<Order | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const done = (load: Load) => {
      if (!cancelled) setResult({ key, load });
    };
    fetchJson<Order>(`/api/orders/${id}`)
      .then(({ data }) => done({ kind: "ready", order: data }))
      .catch(async (error: unknown) => {
        if (error instanceof ClientApiError && error.code === "not_found") {
          if (!storeParam) return done({ kind: "missing" });
          // A new order that has not been saved yet: the store comes from the address.
          try {
            const { data: store } = await fetchJson<Store>(`/api/stores/${storeParam}`);
            return done({ kind: "new", storeName: store.name, storeId: store.id });
          } catch {
            return done({ kind: "missing" });
          }
        }
        done({ kind: "error", message: error instanceof ClientApiError ? error.message : "Something went wrong. Please try again." });
      });
    return () => {
      cancelled = true;
    };
  }, [id, storeParam, key]);

  const load = result?.key === key ? result.load : null;

  if (!load) return <LoadingBlock label="Loading order…" />;
  if (load.kind === "error") return <ErrorState message={load.message} onRetry={() => setAttempt((a) => a + 1)} />;
  if (load.kind === "missing") {
    return (
      <EmptyState
        icon={FileQuestion}
        title="Order not found"
        description="This order does not exist, or it belongs to another account."
        action={<ButtonLink href="/orders/new">Start a new order</ButtonLink>}
      />
    );
  }

  const order = override ?? (load.kind === "ready" ? load.order : null);
  const back = (
    <Link href="/orders" className="inline-flex min-h-11 items-center gap-1 text-primary">
      <ChevronLeft size={20} aria-hidden="true" /> Orders
    </Link>
  );

  if (order && order.status === "confirmed" && editing) {
    return (
      <div className="space-y-2">
        {back}
        <OrderEditor
          key={`${id}|edit|${order.version}`}
          mode="edit"
          orderId={id}
          initialOrder={order}
          storeId={order.store.id}
          storeName={order.store.name}
          onOrderChange={(saved) => {
            setOverride(saved);
            setEditing(false);
          }}
          onExitEdit={() => setEditing(false)}
        />
      </div>
    );
  }

  if (order && order.status !== "draft") {
    return (
      <div className="space-y-2">
        {back}
        <OrderView
          order={order}
          actions={order.status === "confirmed" ? <ConfirmedActions order={order} onEdit={() => setEditing(true)} onCancelled={setOverride} /> : null}
        >
          <OrderHistoryLog events={order.events} />
        </OrderView>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {back}
      <OrderEditor
        key={`${id}|${storeParam ?? ""}`}
        orderId={id}
        initialOrder={order}
        storeId={order?.store.id ?? (load.kind === "new" ? load.storeId : "")}
        storeName={order?.store.name ?? (load.kind === "new" ? load.storeName : "")}
        onOrderChange={setOverride}
      />
    </div>
  );
}
