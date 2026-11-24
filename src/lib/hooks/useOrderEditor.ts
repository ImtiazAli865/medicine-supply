"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fetchJson } from "@/lib/api/client";
import type { DraftHandle } from "@/lib/device/sync-center";
import { newId } from "@/lib/ids";
import { createAutosave, ON_DEVICE_MESSAGE, type Autosave, type SaveOutcome, type SaveRequest } from "@/lib/orders/autosave";
import {
  appendLines,
  cleanTypedName,
  emptyState,
  infoForTyped,
  infoFromOrder,
  infoFromProduct,
  removeLinesById,
  stateFromOrder,
  type EditorState,
  type LineInfo,
} from "@/lib/orders/editor-state";
import type { SlimMedicine } from "@/lib/orders/fast-types";
import { sendSaveRequest } from "@/lib/orders/save-transport";
import type { Order, OrderLineInput, OrderResult } from "@/lib/orders/types";
import type { Product } from "@/lib/products/types";

/** One line for addLines: a catalog medicine (slim or full) or a typed (not registered) line. */
export type NewLineEntry =
  | { kind: "catalog"; medicine: SlimMedicine | Product; quantity: number; unit?: string }
  | { kind: "typed"; name: string; quantity: number; unit: string };

// Binds the autosave machine (src/lib/orders/autosave.ts) to React for one order.

/** The order screen's own save (no device journal): a 401 takes the person to sign-in as before. */
async function sendSave(orderId: string, request: SaveRequest<EditorState>): Promise<SaveOutcome<Order>> {
  const result = await sendSaveRequest(orderId, request, "redirect");
  return result.kind === "unauthorized" ? { kind: "retryable", message: "Sign in again to save this order." } : result;
}

export interface OrderEditorArgs {
  orderId: string;
  /** null for a new order that has not been saved yet. */
  initialOrder: Order | null;
  storeId: string;
  /** draft: every change is saved automatically. edit: a confirmed order, saved only by saveChanges(). */
  mode?: "draft" | "edit";
  /** The draft opened through the sync centre (Module 009): every change is kept on the device and sent by the centre. */
  handle?: DraftHandle | null;
}

export function useOrderEditor({ orderId, initialOrder, storeId, mode = "draft", handle = null }: OrderEditorArgs) {
  const router = useRouter();
  const [machine] = useState<Autosave<EditorState, Order>>(() =>
    handle?.machine ??
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
  const [added, setAdded] = useState<Record<string, LineInfo>>(() => ({ ...(handle?.lineInfo ?? {}), ...(initialOrder ? infoFromOrder(initialOrder) : {}) }));

  // The journal keeps the details shown for each line, so they come back after a restart. They are set BEFORE the edit that
  // needs them, because the journal write follows the edit at once.
  const noteInfo = useCallback(
    (more: Record<string, LineInfo>) => {
      if (handle) handle.setLineInfo({ ...handle.lineInfo, ...more });
    },
    [handle],
  );
  const serverInfo = snapshot.serverOrder ? infoFromOrder(snapshot.serverOrder) : {};
  const info: Record<string, LineInfo> = { ...added, ...(handle?.lineInfo ?? {}), ...serverInfo };

  // Bumped when the screen state is replaced by the server's (rows restart from the new values).
  const [epoch, setEpoch] = useState(0);
  const confirmRequestId = useRef<string | null>(null);

  const update = useCallback(
    (change: (current: EditorState) => EditorState) => machine.edit(change(machine.getLocalState())),
    [machine],
  );

  const addCatalogLine = useCallback(
    (product: SlimMedicine | Product, quantity = 1, unit?: string): string => {
      const id = newId();
      noteInfo({ [id]: infoFromProduct(product) });
      setAdded((prev) => ({ ...prev, [id]: infoFromProduct(product) }));
      update((s) => ({ ...s, lines: [...s.lines, { id, product_id: product.id, name: null, quantity, unit: unit ?? product.unit }] }));
      return id;
    },
    [update, noteInfo],
  );

  /**
   * Adds many lines in ONE change, so one autosave sends one save: the draft is created with all of them or none.
   * Returns the ids of the lines that were added and how many entries were refused (200-line limit, invalid quantity).
   */
  const addLines = useCallback(
    (entries: NewLineEntry[]): { ids: string[]; refused: number } => {
      const infos: Record<string, LineInfo> = {};
      const inputs: OrderLineInput[] = entries.map((entry) => {
        const id = newId();
        if (entry.kind === "catalog") {
          infos[id] = infoFromProduct(entry.medicine);
          return { id, product_id: entry.medicine.id, name: null, quantity: entry.quantity, unit: entry.unit ?? entry.medicine.unit };
        }
        const clean = cleanTypedName(entry.name);
        infos[id] = infoForTyped(clean);
        return { id, product_id: null, name: clean, quantity: entry.quantity, unit: entry.unit.trim() };
      });
      const result = appendLines(machine.getLocalState(), inputs);
      if (result.added.length === 0) return { ids: [], refused: result.refused };
      noteInfo(Object.fromEntries(result.added.map((l) => [l.id, infos[l.id]!])));
      setAdded((prev) => ({ ...prev, ...Object.fromEntries(result.added.map((l) => [l.id, infos[l.id]!])) }));
      machine.edit(result.state);
      return { ids: result.added.map((l) => l.id), refused: result.refused };
    },
    [machine, noteInfo],
  );

  const addTypedLine = useCallback(
    (name: string, quantity: number, unit: string): string => {
      const id = newId();
      const clean = cleanTypedName(name);
      noteInfo({ [id]: infoForTyped(clean) });
      setAdded((prev) => ({ ...prev, [id]: infoForTyped(clean) }));
      update((s) => ({ ...s, lines: [...s.lines, { id, product_id: null, name: clean, quantity, unit: unit.trim() }] }));
      return id;
    },
    [update, noteInfo],
  );

  const updateLine = useCallback(
    (id: string, patch: Partial<Pick<OrderLineInput, "quantity" | "unit" | "name">>) => {
      if (patch.name !== undefined) {
        const clean = cleanTypedName(patch.name ?? "");
        const current = handle?.lineInfo[id];
        if (current) noteInfo({ [id]: { ...current, name: clean } });
        setAdded((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], name: clean } } : prev));
      }
      update((s) => ({
        ...s,
        lines: s.lines.map((l) => (l.id === id ? { ...l, ...patch, name: patch.name !== undefined ? cleanTypedName(patch.name ?? "") : l.name } : l)),
      }));
    },
    [update, handle, noteInfo],
  );

  /** A catalog line the server will not take (for example a medicine made inactive) becomes a typed line with its exact name. */
  const convertLineToTyped = useCallback(
    (id: string) => {
      const current = machine.getLocalState().lines.find((l) => l.id === id);
      if (!current || current.product_id === null) return;
      const name = cleanTypedName((added[id] ?? handle?.lineInfo[id])?.name ?? "Medicine");
      noteInfo({ [id]: infoForTyped(name) });
      setAdded((prev) => ({ ...prev, [id]: infoForTyped(name) }));
      update((s) => ({ ...s, lines: s.lines.map((l) => (l.id === id ? { ...l, product_id: null, name } : l)) }));
    },
    [machine, added, handle, noteInfo, update],
  );

  const removeLine = useCallback((id: string) => update((s) => ({ ...s, lines: s.lines.filter((l) => l.id !== id) })), [update]);
  /** The lines as the editor has them right now (not as of the last render). */
  const getLines = useCallback(() => machine.getLocalState().lines, [machine]);
  /** Removes exactly these lines in one change (used by Undo). */
  const removeLines = useCallback((ids: readonly string[]) => update((s) => removeLinesById(s, ids)), [update]);
  const setNotes = useCallback((notes: string) => update((s) => ({ ...s, notes })), [update]);
  const setStore = useCallback((newStoreId: string) => update((s) => ({ ...s, storeId: newStoreId })), [update]);

  /** Saves every unsaved edit first, then confirms with the version the server returned. */
  const confirm = useCallback(async (): Promise<Order> => {
    try {
      await machine.flush();
    } catch (error) {
      // Only on this phone for now: confirming fixes the prices on the server, so it needs the internet.
      if (error instanceof Error && error.message === ON_DEVICE_MESSAGE) {
        throw new Error("Confirming needs the internet. The order is saved on this phone and can be confirmed when the connection returns.");
      }
      throw error;
    }
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
      if (version === null) {
        // Never reached the server: there is nothing to cancel there; remove it from this phone (the supplier was asked first).
        await handle?.discardLocal();
        return null;
      }
      const { data } = await fetchJson<OrderResult>(`/api/orders/${orderId}/cancel`, {
        json: { request_id: newId(), expected_version: version, reason },
      });
      machine.adopt(stateFromOrder(data.order), data.order.version, data.order);
      return data.order;
    },
    [machine, orderId, handle],
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

  /**
   * Register and Link (Module 004) need the order exactly as the server has it. A draft saves any unsaved edit
   * first; a confirmed order being edited is never saved on the side, so unsaved edits block the action.
   */
  const prepareForPending = useCallback(async (): Promise<{ ok: true; version: number } | { ok: false; message: string }> => {
    if (mode === "edit") {
      const snap = machine.getSnapshot();
      if (snap.isDirty) return { ok: false, message: "Save or discard your changes to this order first." };
      if (snap.version === null) return { ok: false, message: "Save the order first." };
      return { ok: true, version: snap.version };
    }
    try {
      await machine.flush();
    } catch {
      return { ok: false, message: "Save the order first. The latest changes could not be saved." };
    }
    const snap = machine.getSnapshot();
    if (snap.version === null || snap.isDirty) return { ok: false, message: "Save the order first." };
    return { ok: true, version: snap.version };
  }, [machine, mode]);

  /** After "changed elsewhere": replace what is on screen with the server's current order. */
  const adoptServerOrder = useCallback(
    (order: Order) => {
      setAdded(infoFromOrder(order));
      machine.adopt(stateFromOrder(order), order.version, order);
      setEpoch((e) => e + 1);
    },
    [machine],
  );

  // A change that is safely kept on this device needs no warning; one that is only on the screen does.
  const isDirty = snapshot.isDirty && snapshot.status !== "on_device";

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
      const snap = machine.getSnapshot();
      if (!snap.isDirty || snap.status === "on_device") return; // nothing to save, or kept safely on this device
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

  // With a sync-centre handle the centre owns the machine (it keeps sending after this screen is closed); the screen that
  // opened the handle releases it.
  useEffect(
    () => () => {
      if (!handle) machine.dispose();
    },
    [machine, handle],
  );

  return {
    state,
    snapshot,
    info,
    epoch,
    serverOrder: snapshot.serverOrder,
    addCatalogLine,
    addLines,
    getLines,
    addTypedLine,
    updateLine,
    removeLine,
    convertLineToTyped,
    removeLines,
    setNotes,
    setStore,
    confirm,
    discard,
    saveChanges,
    revertChanges,
    retry,
    prepareForPending,
    adoptServerOrder,
  };
}
