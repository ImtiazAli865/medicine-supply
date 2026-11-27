// The preview of an import (Module 009, FR-029/030): every item of the file is classified against what the server and this
// phone hold, and nothing is changed until the supplier confirms. Pure code. The server snapshot is needed, so an import is
// previewed (and applied) only while online: a file is never compared with a guess.

import { parseMoneyToPaisa } from "@/lib/money";
import type { DraftRecord, PaymentOpRecord, StoreOpRecord } from "@/lib/device/schema";
import type { BackupFile, BackupOrder, BackupWaitingOrder, BackupWaitingPayment } from "./file";

export type Verdict = "new" | "already_on_server" | "already_on_device" | "conflict" | "cannot_restore";

export interface ServerSnapshot {
  orders: Map<string, { version: number; status: string }>;
  stores: Set<string>;
}

export interface DeviceSnapshot {
  drafts: Map<string, DraftRecord>;
  storeOps: Map<string, StoreOpRecord>;
  stores: Set<string>;
  /** The payments waiting on this phone, by payment id. */
  payments: Map<string, PaymentOpRecord>;
}

export interface PreviewItem {
  kind: "order" | "store" | "payment";
  id: string;
  label: string;
  verdict: Verdict;
  reason: string;
}

export interface ImportPlan {
  /** Orders to put on this phone as waiting drafts (the normal sync sends them). */
  orders: BackupWaitingOrder[];
  /** Stores to create through the normal store queue. */
  stores: Array<{ id: string; name: string; contact_person: string | null; phone: string | null; address: string | null }>;
  /** Payments to put on this phone as waiting payments (the normal sync sends them; the server records each key once). */
  payments: BackupWaitingPayment[];
}

export interface ImportPreview {
  items: PreviewItem[];
  counts: Record<Verdict, number>;
  plan: ImportPlan;
  /** How many payments would be added to this phone and their exact total in paisa. */
  payments: { count: number; paisa: number };
  /** Something would change if the supplier confirms. */
  canApply: boolean;
}

function sameState(a: DraftRecord, w: BackupWaitingOrder): boolean {
  if (a.state.storeId !== w.storeId || a.state.notes !== w.notes || a.state.lines.length !== w.lines.length) return false;
  return a.state.lines.every((l, i) => {
    const x = w.lines[i]!;
    return (
      l.id === x.id &&
      l.product_id === x.product_id &&
      l.quantity === x.quantity &&
      l.unit === x.unit &&
      (l.price ?? null) === (x.price ?? null) &&
      (l.product_id !== null || l.name === x.name)
    );
  });
}

/** A draft order of the main list becomes a waiting order that has never been sent (the id stays the same). */
export function waitingFromOrder(order: BackupOrder): BackupWaitingOrder {
  return {
    orderId: order.id,
    storeId: order.store_id,
    baseVersion: null,
    neverSent: true,
    syncState: "on_device",
    reason: null,
    notes: order.notes ?? "",
    lines: order.lines.map((l) => ({
      id: l.id,
      product_id: l.product_id,
      name: l.product_id === null ? l.name : null,
      display_name: l.name,
      strength: l.strength ?? null,
      dosage_form: l.dosage_form ?? null,
      pack_size: l.pack_size ?? null,
      manufacturer: l.manufacturer ?? null,
      quantity: l.quantity,
      unit: l.unit,
    })),
  };
}

function orderLabel(storeName: string | undefined, lines: number, id: string): string {
  return `${storeName ?? "Order"} · ${lines} ${lines === 1 ? "line" : "lines"} · ${id.slice(0, 8)}`;
}

export function previewImport(file: BackupFile, server: ServerSnapshot, device: DeviceSnapshot): ImportPreview {
  const items: PreviewItem[] = [];
  const plan: ImportPlan = { orders: [], stores: [], payments: [] };
  const storeNames = new Map<string, string>();
  for (const s of file.stores) storeNames.set(s.id, s.name);
  for (const s of file.waiting.stores) storeNames.set(s.storeId, s.name);

  // Payments come first (money is what the supplier looks for), then stores, then orders.
  const knownStores = new Set<string>([...server.stores, ...device.stores, ...device.storeOps.keys(), ...file.stores.map((s) => s.id), ...file.waiting.stores.map((s) => s.storeId)]);
  const paymentItems: PreviewItem[] = [];
  let paymentPaisa = 0;
  for (const p of file.waiting.payments) {
    const label = `${storeNames.get(p.storeId) ?? "Store"} · PKR ${p.amount} · ${p.date} · ${p.paymentId.slice(0, 8)}`;
    if (device.payments.has(p.paymentId)) {
      paymentItems.push({ kind: "payment", id: p.paymentId, label, verdict: "already_on_device", reason: "This phone already has this payment, waiting to be sent. It is kept as it is." });
      continue;
    }
    const known = knownStores.has(p.storeId);
    paymentItems.push({
      kind: "payment",
      id: p.paymentId,
      label,
      verdict: "new",
      reason: known
        ? "This payment will be kept on this phone and sent. The server records a payment once, also when it already has this one."
        : "This payment will be kept on this phone, but its store is not on this phone or the server, so sending it will ask you what to do.",
    });
    plan.payments.push(p);
    paymentPaisa += parseMoneyToPaisa(p.amount) ?? 0;
  }
  items.push(...paymentItems);

  // Stores next: orders may depend on them.
  const seenStores = new Set<string>();
  const addStore = (id: string, name: string, contact: string | null | undefined, phone: string | null | undefined, address: string | null | undefined) => {
    if (seenStores.has(id)) return;
    seenStores.add(id);
    if (server.stores.has(id)) items.push({ kind: "store", id, label: name, verdict: "already_on_server", reason: "This store is already on the server." });
    else if (device.stores.has(id) || device.storeOps.has(id)) items.push({ kind: "store", id, label: name, verdict: "already_on_device", reason: "This store is already on this phone." });
    else {
      items.push({ kind: "store", id, label: name, verdict: "new", reason: "This store will be created." });
      plan.stores.push({ id, name, contact_person: contact ?? null, phone: phone ?? null, address: address ?? null });
    }
  };
  for (const s of file.waiting.stores) addStore(s.storeId, s.name, s.contact_person, s.phone, null);
  for (const s of file.stores) addStore(s.id, s.name, s.contact_person, s.phone, s.address);

  const waitingIds = new Set(file.waiting.orders.map((w) => w.orderId));

  for (const w of file.waiting.orders) {
    const label = orderLabel(storeNames.get(w.storeId), w.lines.length, w.orderId);
    const onServer = server.orders.get(w.orderId);
    const onDevice = device.drafts.get(w.orderId);
    let verdict: Verdict;
    let reason: string;
    if (onDevice && onDevice.syncState !== "synced") {
      if (sameState(onDevice, w)) {
        verdict = "already_on_device";
        reason = "This phone already has this order, waiting to be sent.";
      } else {
        verdict = "conflict";
        reason = "This phone already has a different version of this order. Nothing is replaced.";
      }
    } else if (!onServer) {
      if (w.baseVersion === null) {
        verdict = "new";
        reason = "This order was never sent. It will be kept on this phone and sent.";
      } else {
        verdict = "conflict";
        reason = "This order was on the server when the backup was made, but it is not there now.";
      }
    } else if (onServer.status !== "draft") {
      verdict = "conflict";
      reason = "The order was confirmed or cancelled on the server after the backup. The server copy is kept.";
    } else if (w.baseVersion === null) {
      verdict = "already_on_server";
      reason = "This order has already reached the server.";
    } else if (w.baseVersion === onServer.version) {
      verdict = "new";
      reason = "The changes waiting in the backup will be kept on this phone and sent.";
    } else {
      verdict = "conflict";
      reason = `The server copy changed after the backup (version ${onServer.version} now, ${w.baseVersion} in the backup). The server copy is kept.`;
    }
    items.push({ kind: "order", id: w.orderId, label, verdict, reason });
    if (verdict === "new") plan.orders.push(w);
  }

  for (const o of file.orders) {
    if (waitingIds.has(o.id)) continue;
    const label = orderLabel(storeNames.get(o.store_id), o.lines.length, o.id);
    const onServer = server.orders.get(o.id);
    const onDevice = device.drafts.get(o.id);
    let verdict: Verdict;
    let reason: string;
    if (onServer) {
      if (onServer.version === o.version) {
        verdict = "already_on_server";
        reason = "This order is already on the server.";
      } else {
        verdict = "conflict";
        reason = `The server copy is different (version ${onServer.version} now, ${o.version} in the backup). The server copy is kept.`;
      }
    } else if (onDevice) {
      verdict = "already_on_device";
      reason = "This phone already has this order.";
    } else if (o.status === "draft") {
      verdict = "new";
      reason = "This draft is not on the server. It will be kept on this phone and sent.";
    } else {
      verdict = "cannot_restore";
      reason = "A confirmed or cancelled order cannot be created again here: confirming needs the prices on the server.";
    }
    items.push({ kind: "order", id: o.id, label, verdict, reason });
    if (verdict === "new") plan.orders.push(waitingFromOrder(o));
  }

  const counts: Record<Verdict, number> = { new: 0, already_on_server: 0, already_on_device: 0, conflict: 0, cannot_restore: 0 };
  for (const i of items) counts[i.verdict] += 1;
  return { items, counts, plan, payments: { count: plan.payments.length, paisa: paymentPaisa }, canApply: plan.orders.length + plan.stores.length + plan.payments.length > 0 };
}
