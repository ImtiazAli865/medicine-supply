// The pure rules of the payment queue on the phone (Module 011): how a waiting payment is made, in which order the payments are
// sent, when one may be removed, how the waiting total is worked out and how the server's refusal is named. Nothing here reads
// the clock, the network or the storage, so every rule is unit-tested without a browser. The sync centre applies these rules.
// A waiting payment holds only what the person typed. The phone never works out a balance, an allocation or a ledger entry.

import type { ValidPayment } from "@/lib/accounts/payment-input";
import { paisaToMoney, parseMoneyToPaisa } from "@/lib/money";
import type { PaymentConflictKind, PaymentOpRecord } from "./schema";

/** What the server answered to sending one waiting payment. A confirmed payment (also a repeat of one already recorded) is `ok`. */
export type PaymentSendResult =
  | { kind: "ok" }
  | { kind: "retryable"; message: string }
  | { kind: "unauthorized" }
  | { kind: "conflict"; conflict: PaymentConflictKind; message: string };

export interface NewPaymentArgs {
  paymentId: string;
  storeId: string;
  input: ValidPayment;
  seq: number;
  /** Display time only; never used for a decision. */
  recordedOn: string;
}

/** A payment recorded on the phone: not sent yet, no attempt made. */
export function newPaymentOp({ paymentId, storeId, input, seq, recordedOn }: NewPaymentArgs): PaymentOpRecord {
  return {
    paymentId,
    rev: 1,
    seq,
    storeId,
    amount: input.amount,
    date: input.date,
    reference: input.reference,
    state: "on_device",
    reason: null,
    conflict: null,
    attempted: false,
    tries: 0,
    nextTryTick: 0,
    recordedOn,
  };
}

/** The sequence number for the next recorded payment (1 for the first). */
export function nextSeq(ops: readonly PaymentOpRecord[]): number {
  return ops.reduce((highest, op) => Math.max(highest, op.seq), 0) + 1;
}

/** The payments in the order they were recorded. The input is not changed. */
export function sendOrder(ops: readonly PaymentOpRecord[]): PaymentOpRecord[] {
  return [...ops].sort((a, b) => a.seq - b.seq);
}

export interface DueContext {
  /** Stores made on the phone that the server has not created yet. A payment for one of them is held. */
  pendingStoreIds: ReadonlySet<string>;
  /** Payments that are waiting for their retry (a timer is running for them). */
  retryingIds: ReadonlySet<string>;
}

/**
 * The payments that may be sent now: at most one for each store, the first one recorded for that store that is still to be sent.
 * - A payment that is sending, or waiting for its retry, holds back the later payments of its own store only.
 * - A payment for a store that is still waiting on the phone is held (and holds back that store's later payments).
 * - A payment in conflict is never sent by itself and never holds anything back: the supplier decides about it.
 * The result is in the order recorded.
 */
export function dueNow(ops: readonly PaymentOpRecord[], context: DueContext): PaymentOpRecord[] {
  const headSeen = new Set<string>();
  const due: PaymentOpRecord[] = [];
  for (const op of sendOrder(ops)) {
    if (op.state === "conflict") continue;
    if (headSeen.has(op.storeId)) continue;
    headSeen.add(op.storeId);
    if (op.state === "syncing") continue;
    if (context.retryingIds.has(op.paymentId)) continue;
    if (context.pendingStoreIds.has(op.storeId)) continue;
    due.push(op);
  }
  return due;
}

/** The first payment that may be sent now, or null. */
export function nextDue(ops: readonly PaymentOpRecord[], context: DueContext): PaymentOpRecord | null {
  return dueNow(ops, context)[0] ?? null;
}

/** True when the payment belongs to a store that is still waiting on the phone (it cannot be sent yet). */
export function isHeldForStore(op: PaymentOpRecord, pendingStoreIds: ReadonlySet<string>): boolean {
  return pendingStoreIds.has(op.storeId);
}

/**
 * Whether the person may remove the payment from the phone (after a confirmation that names the amount and the store).
 * A payment in conflict can be removed: the supplier has seen the server's reason. A payment never sent can be removed.
 * A payment that was sent (or may have been) and has no answer can never be removed: it may already be on the server.
 */
export function canRemove(op: PaymentOpRecord): boolean {
  if (op.state === "conflict") return true;
  return !op.attempted;
}

/**
 * Moves the payments of one store to another store (the supplier chose "use the existing store" for a similar store).
 * Only the payments of `fromStoreId` change; the others are returned as the very same objects.
 */
export function remapStore(ops: readonly PaymentOpRecord[], fromStoreId: string, toStoreId: string): PaymentOpRecord[] {
  return ops.map((op) => (op.storeId === fromStoreId ? { ...op, storeId: toStoreId } : op));
}

export interface WaitingTotal {
  count: number;
  /** Exact sum in integer paisa. */
  paisa: number;
}

export interface WaitingTotals extends WaitingTotal {
  byStore: Record<string, WaitingTotal>;
}

/** How many payments wait on the phone and their exact total, overall and for each store (integer paisa, never floating point). */
export function waitingTotals(ops: readonly PaymentOpRecord[]): WaitingTotals {
  const byStore: Record<string, WaitingTotal> = {};
  let count = 0;
  let paisa = 0;
  for (const op of ops) {
    const value = parseMoneyToPaisa(op.amount);
    if (value === null) continue; // never happens for a record made by newPaymentOp; a damaged record is not counted
    count += 1;
    paisa += value;
    const entry = byStore[op.storeId] ?? { count: 0, paisa: 0 };
    entry.count += 1;
    entry.paisa += value;
    byStore[op.storeId] = entry;
  }
  return { count, paisa, byStore };
}

/** "2 payments waiting on this phone, PKR 7,500.00, not counted yet". */
export function formatWaiting(totals: WaitingTotal): string {
  if (totals.count === 0) return "No payments waiting on this phone.";
  const noun = totals.count === 1 ? "payment" : "payments";
  return `${totals.count} ${noun} waiting on this phone, ${formatPaisa(totals.paisa)}, not counted yet`;
}

/** "PKR 7,500.00" from integer paisa. A sum of waiting payments may be larger than one payment can be, so this has no upper limit. */
export function formatPaisa(paisa: number): string {
  const [whole = "0", fraction = "00"] = paisaToMoney(paisa).split(".");
  return `PKR ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

/**
 * Names the server's refusal of a payment. Only the refusals that mean "this payment cannot be recorded as it is" are conflicts.
 * Anything else (a server error, no network) is not a conflict: the payment keeps waiting and is sent again.
 */
export function conflictFromAnswer(answer: { code: string; status: number }): PaymentConflictKind | null {
  if (answer.code === "not_found") return "not_found";
  if (answer.code === "request_reused") return "request_reused";
  if (answer.code === "validation_error") return "refused";
  return null;
}
