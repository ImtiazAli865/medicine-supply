// Applies a confirmed import (Module 009): the orders and stores of the plan become waiting items of the normal queue, so
// there is ONE path to the server and one place where duplicates are prevented (the order id, the request id and the store id).
// Nothing is created a second time: an order or store that is already on this phone is skipped, and nothing on the server
// is touched here.

import { emptyDraft, Journal } from "@/lib/device/journal";
import type { BusinessDatabase, StoreOpRecord } from "@/lib/device/schema";
import type { EditorState, LineInfo } from "@/lib/orders/editor-state";
import type { BackupWaitingOrder } from "./file";
import type { ImportPlan } from "./preview";

export interface ApplyResult {
  ordersAdded: number;
  ordersSkipped: number;
  storesAdded: number;
  storesSkipped: number;
  failed: string[];
}

function stateOf(w: BackupWaitingOrder): EditorState {
  return {
    storeId: w.storeId,
    notes: w.notes,
    lines: w.lines.map((l) => ({ id: l.id, product_id: l.product_id, name: l.product_id === null ? (l.name ?? l.display_name ?? "") : null, quantity: l.quantity, unit: l.unit })),
  };
}

function infoOf(w: BackupWaitingOrder): Record<string, LineInfo> {
  const info: Record<string, LineInfo> = {};
  for (const l of w.lines) {
    info[l.id] = {
      name: l.display_name ?? l.name ?? "",
      typed_name: null,
      strength: l.strength ?? null,
      dosage_form: l.dosage_form ?? null,
      pack_size: l.pack_size ?? null,
      manufacturer: l.manufacturer ?? null,
      selling_price: null,
      price_basis: "none",
      typed: l.product_id === null,
    };
  }
  return info;
}

export async function applyImport(plan: ImportPlan, db: BusinessDatabase, nowText: () => string): Promise<ApplyResult> {
  const journal = new Journal(db);
  const result: ApplyResult = { ordersAdded: 0, ordersSkipped: 0, storesAdded: 0, storesSkipped: 0, failed: [] };

  for (const s of plan.stores) {
    const existing = await db.get("storeOps", s.id);
    const store = await db.get("stores", s.id);
    if (existing || (store && !store.pending)) {
      result.storesSkipped += 1;
      continue;
    }
    const op: StoreOpRecord = {
      storeId: s.id,
      rev: 1,
      seq: 0,
      payload: { id: s.id, name: s.name, contact_person: s.contact_person, phone: s.phone, address: s.address, notes: null },
      confirmDuplicate: false,
      state: "on_device",
      reason: null,
      matches: [],
      tries: 0,
      nextTryTick: 0,
    };
    try {
      await db.batch([
        { op: "put", store: "storeOps", value: op },
        { op: "put", store: "stores", value: { id: s.id, name: s.name, contact_person: s.contact_person, phone: s.phone, address: s.address, is_active: true, pending: true } },
      ]);
      result.storesAdded += 1;
    } catch {
      result.failed.push(`Store ${s.name} could not be kept on this phone.`);
    }
  }

  for (const w of plan.orders) {
    const write = await journal.apply(w.orderId, null, () => ({
      ...emptyDraft(w.orderId, stateOf(w), infoOf(w), nowText()),
      baseVersion: w.baseVersion,
      neverSent: w.baseVersion === null,
    }));
    if (write.ok) result.ordersAdded += 1;
    else if (write.reason === "rev_conflict") result.ordersSkipped += 1;
    else result.failed.push(`Order ${w.orderId.slice(0, 8)} could not be kept on this phone.`);
  }
  return result;
}
