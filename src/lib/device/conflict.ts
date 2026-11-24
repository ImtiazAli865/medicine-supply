// Pure rules for conflicts on the device (Module 009, FR-018 to FR-022): which choices exist, what each one will change (the
// sentence shown BEFORE anything is replaced), how the phone version and the server version differ, and how "keep both"
// makes a new draft. No decision uses the phone's clock; versions come from the server.

import { stateFromOrder, type EditorState, type LineInfo } from "@/lib/orders/editor-state";
import type { Order } from "@/lib/orders/types";
import type { ConflictKind, ConflictRecord, DraftRecord } from "./schema";

export type Choice = "keep_phone" | "keep_server" | "keep_both";

/** The kind of conflict for a server answer that said "changed elsewhere": a draft that is still editable is a plain change. */
export function kindOfServerConflict(current: Order | null): ConflictKind {
  if (current === null) return "missing";
  return current.status === "draft" ? "changed" : "not_editable";
}

/** A refusal that held the send: a medicine or a store the server will not take. */
export function kindOfRefusal(fields: Record<string, string> | undefined): "line_problem" | "store_problem" | null {
  if (fields?.lines) return "line_problem";
  if (fields?.store_id) return "store_problem";
  return null;
}

export function conflictFrom(kind: ConflictKind, server: Order | null, message: string): ConflictRecord {
  return { kind, server, message };
}

/** Which choices the supplier is offered. "Keep the phone version" needs a server order that is still an editable draft. */
export function availableChoices(conflict: ConflictRecord): Choice[] {
  switch (conflict.kind) {
    case "changed":
      return conflict.server?.status === "draft" ? ["keep_phone", "keep_server", "keep_both"] : ["keep_server", "keep_both"];
    case "not_editable":
    case "missing":
      return conflict.server ? ["keep_server", "keep_both"] : ["keep_both"];
    case "line_problem":
    case "store_problem":
      return [];
  }
}

function linesWord(n: number): string {
  return `${n} ${n === 1 ? "line" : "lines"}`;
}

/** The sentence shown before a choice is applied: what will replace what and what will be lost. */
export function describeChoice(choice: Choice, phone: EditorState, conflict: ConflictRecord): string {
  const server = conflict.server;
  const serverLines = server ? server.lines.length : 0;
  switch (choice) {
    case "keep_phone":
      return `The server order (${linesWord(serverLines)}${server ? `, version ${server.version}` : ""}) will be replaced by the order on this phone (${linesWord(phone.lines.length)}). The server's current lines will no longer be on the order.`;
    case "keep_server":
      return `The order on this phone (${linesWord(phone.lines.length)}) will be deleted from this phone and the server's order (${linesWord(serverLines)}) is kept. The phone's changes will be lost.`;
    case "keep_both":
      return `The server's order stays as it is (${linesWord(serverLines)}). The lines on this phone (${linesWord(phone.lines.length)}) become a new separate draft order for the same store.`;
  }
}

export interface DiffRow {
  key: string;
  phone: { name: string; quantity: number; unit: string } | null;
  server: { name: string; quantity: number; unit: string } | null;
  /** The two sides differ (a line is on one side only, or the quantity or unit is not the same). */
  differs: boolean;
}

/** The phone's lines next to the server's lines, matched by line id and then by medicine, for the side-by-side view. */
export function diffLines(phone: EditorState, info: Record<string, LineInfo>, server: Order | null): DiffRow[] {
  const rows: DiffRow[] = [];
  const serverLines = [...(server?.lines ?? [])];
  const used = new Set<string>();
  for (const l of phone.lines) {
    const name = info[l.id]?.name ?? l.name ?? "Medicine";
    const match = serverLines.find((s) => !used.has(s.id) && (s.id === l.id || (l.product_id !== null && s.product_id === l.product_id)));
    if (match) used.add(match.id);
    const p = { name, quantity: l.quantity, unit: l.unit };
    const s = match ? { name: match.name, quantity: match.quantity, unit: match.unit } : null;
    rows.push({ key: l.id, phone: p, server: s, differs: !s || s.quantity !== p.quantity || s.unit !== p.unit });
  }
  for (const s of serverLines) {
    if (used.has(s.id)) continue;
    rows.push({ key: s.id, phone: null, server: { name: s.name, quantity: s.quantity, unit: s.unit }, differs: true });
  }
  return rows;
}

/** The new draft that "keep both" makes: the same store and lines, new order id and new line ids, never sent. */
export function keepBothDraft(record: DraftRecord, newOrderId: string, newLineId: () => string, nowText: string): DraftRecord {
  const idMap = new Map<string, string>();
  const lines = record.state.lines.map((l) => {
    const id = newLineId();
    idMap.set(l.id, id);
    return { ...l, id };
  });
  const lineInfo: Record<string, LineInfo> = {};
  for (const [oldId, newId] of idMap) if (record.lineInfo[oldId]) lineInfo[newId] = record.lineInfo[oldId]!;
  return {
    orderId: newOrderId,
    rev: 0,
    seq: 0,
    state: { ...record.state, lines },
    lineInfo,
    baseVersion: null,
    inflight: null,
    serverOrder: null,
    syncState: "on_device",
    reason: null,
    conflict: null,
    tries: 0,
    nextTryTick: 0,
    neverSent: true,
    updatedOnDevice: nowText,
  };
}

/** "Keep the server version": the screen state becomes the server's order. */
export function serverState(server: Order): EditorState {
  return stateFromOrder(server);
}
