"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import { newId } from "@/lib/ids";
import { createAutosave, type Autosave, type SaveOutcome, type SaveRequest } from "@/lib/orders/autosave";
import {
  cleanTypedName,
  emptyState,
  infoForTyped,
  infoFromOrder,
  infoFromProduct,
  stateFromOrder,
  toSaveInput,
  type EditorState,
  type LineInfo,
} from "@/lib/orders/editor-state";
import type { Order, OrderLineInput, OrderResult } from "@/lib/orders/types";
import type { Product } from "@/lib/products/types";

// Binds the autosave machine (src/lib/orders/autosave.ts) to React for one order.

async function sendSave(orderId: string, request: SaveRequest<EditorState>): Promise<SaveOutcome<Order>> {
  try {
    const { data } = await fetchJson<OrderResult>(`/api/orders/${orderId}`, {
      method: "PUT",
      json: toSaveInput(request.state, request.requestId, request.expectedVersion),
    });
    return { kind: "ok", version: data.order.version, savedAt: data.order.updated_at, order: data.order };
  } catch (error) {
    if (error instanceof ClientApiError) {
      if (error.code === "version_conflict" || error.code === "order_not_editable" || error.code === "store_locked") {
        return error.current ? { kind: "conflict", current: error.current as Order } : { kind: "fatal", message: error.message };
      }
      if (error.code === "network" || error.status >= 500) return { kind: "retryable", message: error.message };
      return { kind: "fatal", message: error.fields?.lines ?? error.fields?.store_id ?? error.message };
    }
    throw error;
  }
}

export interface OrderEditorArgs {
  orderId: string;
  /** null for a new order that has not been saved yet. */
  initialOrder: Order | null;
  storeId: string;
  /** draft: every change is saved automatically. edit: a confirmed order, saved only by saveChanges(). */
  mode?: "draft" | "edit";
}

export function useOrderEditor({ orderId, initialOrder, storeId, mode = "draft" }: OrderEditorArgs) {
  const router = useRouter();
  const [machine] = useState<Autosave<EditorState, Order>>(() =>
    createAutosave<EditorState, Order>(
      { send: (request) => sendSave(orderId, request), newId, manual: mode === "edit" },
      {
        state: initialOrder ? stateFromOrder(initialOrder) : emptyState(storeId),
        version: initialOrder?.version ?? null,
        savedAt: initialOrder?.updated_at ?? null,
        order: initialOrder,
      },
    ),
  );
  const snapshot = useSyncExternalStore(machine.subscribe, machine.getSnapshot, machine.getSnapshot);
  const state = snapshot.state;

  // Display-only details for lines added on this screen; the server's order wins once it has returned them.
  const [added, setAdded] = useState<Record<string, LineInfo>>(() => (initialOrder ? infoFromOrder(initialOrder) : {}));
  const serverInfo = snapshot.serverOrder ? infoFromOrder(snapshot.serverOrder) : {};
  const info: Record<string, LineInfo> = { ...added, ...serverInfo };

  // Bumped when the screen state is replaced by the server's (rows restart from the new values).
  const [epoch, setEpoch] = useState(0);
  const confirmRequestId = useRef<string | null>(null);

  const update = useCallback(
    (change: (current: EditorState) => EditorState) => machine.edit(change(machine.getLocalState())),
    [machine],
  );

  const addCatalogLine = useCallback(
    (product: Product, quantity = 1): string => {
      const id = newId();
      setAdded((prev) => ({ ...prev, [id]: infoFromProduct(product) }));
      update((s) => ({ ...s, lines: [...s.lines, { id, product_id: product.id, name: null, quantity, unit: product.unit }] }));
      return id;
    },
    [update],
  );

  const addTypedLine = useCallback(
    (name: string, quantity: number, unit: string): string => {
      const id = newId();
      const clean = cleanTypedName(name);
      setAdded((prev) => ({ ...prev, [id]: infoForTyped(clean) }));
      update((s) => ({ ...s, lines: [...s.lines, { id, product_id: null, name: clean, quantity, unit: unit.trim() }] }));
      return id;
    },
    [update],
  );

  const updateLine = useCallback(
    (id: string, patch: Partial<Pick<OrderLineInput, "quantity" | "unit" | "name">>) => {
      if (patch.name !== undefined) {
        const clean = cleanTypedName(patch.name ?? "");
        setAdded((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], name: clean } } : prev));
      }
      update((s) => ({
        ...s,
        lines: s.lines.map((l) => (l.id === id ? { ...l, ...patch, name: patch.name !== undefined ? cleanTypedName(patch.name ?? "") : l.name } : l)),
      }));
    },
    [update],
  );

  const removeLine = useCallback((id: string) => update((s) => ({ ...s, lines: s.lines.filter((l) => l.id !== id) })), [update]);
  const setNotes = useCallback((notes: string) => update((s) => ({ ...s, notes })), [update]);
  const setStore = useCallback((newStoreId: string) => update((s) => ({ ...s, storeId: newStoreId })), [update]);

  /** Saves every unsaved edit first, then confirms with the version the server returned. */
  const confirm = useCallback(async (): Promise<Order> => {
    await machine.flush();
    const version = machine.getSnapshot().version;
    if (version === null) throw new Error("Add at least one medicine before confirming the order.");
    confirmRequestId.current ??= newId();
    const { data } = await fetchJson<OrderResult>(`/api/orders/${orderId}/confirm`, {
      json: { request_id: confirmRequestId.current, expected_version: version },
    });
    confirmRequestId.current = null;
    machine.adopt(stateFromOrder(data.order), data.order.version, data.order);
    return data.order;
  }, [machine, orderId]);

  /** Cancels (discards) the order. A draft that was never saved has nothing to cancel. */
  const discard = useCallback(
    async (reason: string | null): Promise<Order | null> => {
      await machine.flush().catch(() => undefined); // best effort: the last saved version is what gets cancelled
      const version = machine.getSnapshot().version;
      if (version === null) return null;
      const { data } = await fetchJson<OrderResult>(`/api/orders/${orderId}/cancel`, {
        json: { request_id: newId(), expected_version: version, reason },
      });
      machine.adopt(stateFromOrder(data.order), data.order.version, data.order);
      return data.order;
    },
    [machine, orderId],
  );

  /** Edit mode: saves all the changes made on this screen as one change and returns the saved order. */
  const saveChanges = useCallback(async (): Promise<Order> => {
    await machine.flush();
    const order = machine.getSnapshot().serverOrder;
    if (!order) throw new Error("The order could not be saved.");
    return order;
  }, [machine]);

  /** Edit mode: throws away the unsaved changes and returns the last saved order. */
  const revertChanges = useCallback((): Order | null => {
    const order = machine.getSnapshot().serverOrder;
    if (order) {
      setAdded(infoFromOrder(order));
      machine.adopt(stateFromOrder(order), order.version, order);
      setEpoch((e) => e + 1);
    }
    return order;
  }, [machine]);

  const retry = useCallback(() => machine.retry(), [machine]);

  /** After "changed elsewhere": replace what is on screen with the server's current order. */
  const adoptServerOrder = useCallback(
    (order: Order) => {
      setAdded(infoFromOrder(order));
      machine.adopt(stateFromOrder(order), order.version, order);
      setEpoch((e) => e + 1);
    },
    [machine],
  );

  const isDirty = snapshot.isDirty;

  // Warn before the page is closed or reloaded with an unsaved change.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  // Save promptly when the app goes to the background or the connection comes back.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden" && machine.getSnapshot().isDirty) machine.flush().catch(() => undefined);
    };
    const onOnline = () => {
      if (machine.getSnapshot().status === "not_saved") machine.retry();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("online", onOnline);
    };
  }, [machine]);

  // In-app navigation with an unsaved change: save first, and ask before leaving if that fails.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.origin !== window.location.origin) return;
      if (!machine.getSnapshot().isDirty) return;
      event.preventDefault();
      event.stopPropagation();
      const href = anchor.pathname + anchor.search + anchor.hash;
      machine
        .flush()
        .then(() => router.push(href))
        .catch(() => {
          if (window.confirm("Your last change is not saved yet. Leave this order anyway?")) router.push(href);
        });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [machine, router]);

  useEffect(() => () => machine.dispose(), [machine]);

  return {
    state,
    snapshot,
    info,
    epoch,
    serverOrder: snapshot.serverOrder,
    addCatalogLine,
    addTypedLine,
    updateLine,
    removeLine,
    setNotes,
    setStore,
    confirm,
    discard,
    saveChanges,
    revertChanges,
    retry,
    adoptServerOrder,
  };
}
