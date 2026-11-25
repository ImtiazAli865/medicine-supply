// The sync centre (Module 009, plan D5): one object per signed-in business on this device that owns the autosave machine of
// every draft that has a change the server has not confirmed, so they keep retrying after the order screen is closed.
//
//  - It sends only while this tab is the sender (Web Lock) or the draft is open on this tab's own screen, the connection is
//    up, sending is not paused and no sign-in is needed; one request at a time per draft, drafts in the order they were first changed.
//  - A request that has no answer yet is kept in the journal (with its id) BEFORE it is sent, so a retry after a restart
//    repeats exactly that request and the server applies it once.
//  - Waits between tries grow (2 s, 5 s, 15 s, 45 s, 2 minutes); an item that fails never blocks unrelated drafts; the
//    order of sending and every decision use counters and server versions, never the phone's clock.
//  - A 401 pauses all sending and keeps every item; nothing is sent under another account because the database belongs to
//    the signed-in business.

import { createAutosave, type Autosave, type AutosaveSnapshot, type DurableSnapshot, type SaveOutcome, type SaveRequest } from "@/lib/orders/autosave";
import { emptyState, stateFromOrder, type EditorState, type LineInfo } from "@/lib/orders/editor-state";
import type { Order } from "@/lib/orders/types";
import { nextDelayMs } from "./backoff";
import type { Connectivity, Scheduler } from "./connectivity";
import { keepBothDraft } from "./conflict";
import { emptyDraft, Journal } from "./journal";
import type { LeaderElection } from "./locks";
import { canRemove, dueNow, newPaymentOp, nextSeq, remapStore, waitingTotals, type PaymentSendResult, type WaitingTotal } from "./payments";
import type { BusinessDatabase, DraftRecord, PaymentConflictKind, PaymentOpRecord, StoreOpPayload, StoreOpRecord, StoredStore, SyncState } from "./schema";
import { validatePaymentInput, type PaymentFields, type PaymentInput } from "@/lib/accounts/payment-input";
import { todayInPakistan } from "@/lib/orders/dates";

export const DEVICE_CONFLICT_MESSAGE = "This order was changed in another tab of this phone.";

export type SendResult = SaveOutcome<Order> | { kind: "unauthorized" };

/** What the server answered to a store create: created (or the same id again), a similar store exists, or a failure. */
export type StoreSendResult =
  | { kind: "ok" }
  | { kind: "similar"; matches: Array<{ id: string; name: string }> }
  | { kind: "retryable"; message: string }
  | { kind: "fatal"; message: string }
  | { kind: "unauthorized" };

/** How often the sending tab looks for drafts that another tab left unsent. */
const JOURNAL_CHECK_MS = 30_000;

export interface SyncCenterDeps {
  db: BusinessDatabase;
  connectivity: Connectivity;
  election: LeaderElection;
  /** Sends one save request of one draft to the server (the real one is PUT /api/orders/{id}). */
  transport: (orderId: string, request: SaveRequest<EditorState>) => Promise<SendResult>;
  /** Creates a store that was made on the phone (the real one is POST /api/stores with the client's id). */
  storeTransport?: (payload: StoreOpPayload, confirmDuplicate: boolean) => Promise<StoreSendResult>;
  /** Sends one waiting payment (the real one is POST /api/accounts/{storeId}/payments with the payment's own key). */
  paymentTransport?: (op: PaymentOpRecord) => Promise<PaymentSendResult>;
  /** The Pakistan calendar day, YYYY-MM-DD, for the date rule of a new payment. */
  today?: () => string;
  scheduler: Scheduler;
  newId: () => string;
  /** Display time only; never used for a decision. */
  nowText: () => string;
  debounceMs?: number;
}

export type ItemState = "waiting" | "syncing" | "failed" | "conflict" | "blocked" | "similar";

/** What a waiting payment shows on the status screens (the typed values only; the phone keeps nothing else about it). */
export interface PaymentItemDetail {
  paymentId: string;
  amount: string;
  date: string;
  reference: string | null;
  conflict: PaymentConflictKind | null;
  /** False for a payment that was sent and has no answer yet: it can only be sent again. */
  canRemove: boolean;
  recordedOn: string;
}

export interface SyncItem {
  /**
   * "store" for a store made on this phone that is not on the server yet (its id is in `orderId` and `storeId`);
   * "payment" for a cash payment recorded on this phone that the server has not confirmed (its id is in `orderId`).
   */
  kind: "order" | "store" | "payment";
  orderId: string;
  storeId: string;
  /** The store's name (for a store item). */
  name: string | null;
  /** Stores the server found with a similar name (a store item waiting for the supplier's answer). */
  matches: Array<{ id: string; name: string }>;
  state: ItemState;
  reason: string | null;
  lines: number;
  neverSent: boolean;
  tries: number;
  /** Set for a payment item only. */
  payment: PaymentItemDetail | null;
}

export interface SyncStatus {
  online: boolean;
  /** This tab is the one that sends. */
  leader: boolean;
  paused: boolean;
  /** Sending stopped because the session expired; the same user must sign in again. */
  needsSignIn: boolean;
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  counts: { waiting: number; syncing: number; failed: number; conflict: number; blocked: number };
  /** Stores made on this phone that the server has not created yet. */
  pendingStoreIds: string[];
  items: SyncItem[];
  /** Payments recorded on this phone that the server has not confirmed, by state. They are also part of `counts`. */
  payments: { waiting: number; syncing: number; conflict: number };
  /** How many payments wait on this phone and their exact total, overall. */
  waitingTotal: WaitingTotal;
  /** The same for each store (only stores that have a waiting payment appear). */
  waitingByStore: Record<string, WaitingTotal>;
}

export type RecordPaymentResult =
  | { ok: true; payment: PaymentOpRecord }
  | { ok: false; reason: "invalid"; fields: PaymentFields }
  | { ok: false; reason: "duplicate" | "storage"; message: string };

export interface OpenArgs {
  orderId: string;
  /** The order as the server has it (opened online), or null for a new order. */
  serverOrder: Order | null;
  storeId: string;
  lineInfo: Record<string, LineInfo>;
}

export interface DraftHandle {
  machine: Autosave<EditorState, Order>;
  /** The details the screen shows for each line; kept with the draft so it can be shown again after a restart. */
  setLineInfo(info: Record<string, LineInfo>): void;
  /** True when the draft came back from the journal (unsent changes from an earlier session). */
  readonly recovered: boolean;
  readonly lineInfo: Record<string, LineInfo>;
  /** Removes an order that never reached the server from this phone (the caller has asked the supplier first). False when it is on the server. */
  discardLocal(): Promise<boolean>;
  /** After a conflict: keep the phone version on top of the server's current order and send it (the caller showed the preview and asked first). */
  resolveKeepPhone(): boolean;
  /** After a conflict: make the phone lines a new separate draft (new id) and leave the server order as it is. Returns the new order id. */
  resolveKeepBoth(): Promise<string | null>;
  release(): void;
}

interface Entry {
  orderId: string;
  machine: Autosave<EditorState, Order>;
  unsubscribe: () => void;
  refs: number;
  rev: number | null;
  seq: number;
  storeId: string;
  lineInfo: Record<string, LineInfo>;
  tries: number;
  timer: unknown;
  recovered: boolean;
  lastStatus: string;
  /** Set only while the person's own Retry starts a request: the request itself shows whether the connection works. */
  forced: boolean;
}

const EMPTY_STATUS: SyncStatus = {
  online: true,
  leader: true,
  paused: false,
  needsSignIn: false,
  lastSyncAt: null,
  lastAttemptAt: null,
  counts: { waiting: 0, syncing: 0, failed: 0, conflict: 0, blocked: 0 },
  pendingStoreIds: [],
  items: [],
  payments: { waiting: 0, syncing: 0, conflict: 0 },
  waitingTotal: { count: 0, paisa: 0 },
  waitingByStore: {},
};

export class SyncCenter {
  private readonly journal: Journal;
  private readonly entries = new Map<string, Entry>();
  /** Stores made on this phone that the server has not created yet, by store id. */
  private readonly storeOps = new Map<string, StoreOpRecord>();
  private readonly storeTimers = new Map<string, unknown>();
  /** Cash payments recorded on this phone that the server has not confirmed, by payment id. */
  private readonly paymentOps = new Map<string, PaymentOpRecord>();
  private readonly paymentTimers = new Map<string, unknown>();
  /** Payments being removed from the storage right now (so a reload cannot bring one back). */
  private readonly removingPayments = new Set<string>();
  /** Payments the supplier's own Retry asked for: tried at once, even in a tab that is not the sender and while the flag says offline. */
  private readonly forcedPayments = new Set<string>();
  private journalTimer: unknown = null;
  private readonly listeners = new Set<() => void>();
  private status: SyncStatus = EMPTY_STATUS;
  private paused = false;
  private needsSignIn = false;
  private lastSyncAt: string | null = null;
  private lastAttemptAt: string | null = null;
  private waking = false;
  private wakeAgain = false;
  private stopped = false;
  private readonly offs: Array<() => void> = [];

  constructor(private readonly deps: SyncCenterDeps) {
    this.journal = new Journal(deps.db);
    this.offs.push(
      deps.connectivity.subscribe(() => {
        this.emit();
        void this.wake();
      }),
    );
    this.offs.push(
      deps.election.subscribe(() => {
        this.emit();
        void this.wake();
      }),
    );
  }

  // ---------------------------------------------------------------- start / stop

  /** Loads the drafts with unsynced changes from the journal and starts sending them when sending is possible. */
  async start(): Promise<void> {
    const meta = async (key: "lastSyncAt" | "lastSyncAttemptAt") => ((await this.deps.db.get("meta", key))?.value as string | undefined) ?? null;
    this.lastSyncAt = await meta("lastSyncAt");
    this.lastAttemptAt = await meta("lastSyncAttemptAt");
    this.paused = ((await this.deps.db.get("meta", "sendingPaused"))?.value as boolean | undefined) ?? false;
    for (const op of await this.deps.db.getAll("storeOps")) if (op.state !== "synced") this.storeOps.set(op.storeId, op);
    await this.loadPayments();
    for (const record of await this.journal.listUnsynced()) {
      if (!this.entries.has(record.orderId)) this.attach(record, 0);
    }
    this.emit();
    void this.wake();
    this.scheduleJournalCheck();
  }

  /**
   * Reads the waiting payments from the phone's storage. A payment that was being sent when the app closed has no answer yet, so it
   * comes back as waiting (still `attempted`, so it can only be sent again, with the same key).
   */
  private async loadPayments(): Promise<void> {
    for (const stored of await this.deps.db.getAll("paymentOps")) {
      if (this.paymentOps.has(stored.paymentId) || this.removingPayments.has(stored.paymentId)) continue;
      this.paymentOps.set(stored.paymentId, stored.state === "syncing" ? { ...stored, state: "waiting" } : stored);
    }
  }

  /** The tab that sends also looks at the journal now and then, so a draft left unsent by another tab is not forgotten. */
  private scheduleJournalCheck(): void {
    if (this.stopped || this.journalTimer !== null) return;
    this.journalTimer = this.deps.scheduler.set(() => {
      this.journalTimer = null;
      if (this.stopped) return;
      const next = () => this.scheduleJournalCheck();
      if (this.deps.election.isLeader() && this.deps.connectivity.getState() === "online") void this.adoptJournal().catch(() => undefined).finally(next);
      else next();
    }, JOURNAL_CHECK_MS);
  }

  /** Picks up drafts and stores that were written to the journal from outside (an import) and starts sending them. */
  async adoptJournal(): Promise<void> {
    for (const op of await this.deps.db.getAll("storeOps")) if (op.state !== "synced" && !this.storeOps.has(op.storeId)) this.storeOps.set(op.storeId, op);
    await this.loadPayments();
    for (const record of await this.journal.listUnsynced()) {
      if (!this.entries.has(record.orderId)) this.attach(record, 0);
    }
    this.emit();
    void this.wake();
  }

  stop(): void {
    this.stopped = true;
    if (this.journalTimer !== null) this.deps.scheduler.clear(this.journalTimer);
    this.journalTimer = null;
    for (const off of this.offs.splice(0)) off();
    for (const e of this.entries.values()) {
      if (e.timer !== null) this.deps.scheduler.clear(e.timer);
      e.unsubscribe();
      e.machine.dispose();
    }
    this.entries.clear();
    for (const t of this.storeTimers.values()) this.deps.scheduler.clear(t);
    this.storeTimers.clear();
    for (const t of this.paymentTimers.values()) this.deps.scheduler.clear(t);
    this.paymentTimers.clear();
    this.listeners.clear();
  }

  // ---------------------------------------------------------------- the editor's side

  /** Opens a draft for editing. Several screens opening the same draft share one machine. */
  async openDraft(args: OpenArgs): Promise<DraftHandle> {
    const existing = this.entries.get(args.orderId);
    if (existing) {
      existing.refs += 1;
      return this.handleFor(existing);
    }
    let record = await this.journal.get(args.orderId);
    if (!record && args.serverOrder) {
      // An order opened from the server is kept as a synced copy so it can be edited offline later.
      const copy = emptyDraft(args.orderId, stateFromOrder(args.serverOrder), args.lineInfo, this.deps.nowText());
      const written = await this.journal.apply(args.orderId, null, () => ({
        ...copy,
        baseVersion: args.serverOrder!.version,
        serverOrder: args.serverOrder,
        syncState: "synced",
        neverSent: false,
      }));
      record = written.ok ? written.draft : undefined;
    }
    const entry = this.attach(record ?? this.blankRecord(args), 1, args);
    return this.handleFor(entry);
  }

  private blankRecord(args: OpenArgs): DraftRecord {
    return { ...emptyDraft(args.orderId, emptyState(args.storeId), args.lineInfo, this.deps.nowText()), rev: 0 };
  }

  private handleFor(entry: Entry): DraftHandle {
    let released = false;
    return {
      machine: entry.machine,
      recovered: entry.recovered,
      get lineInfo() {
        return entry.lineInfo;
      },
      setLineInfo: (info) => {
        entry.lineInfo = info;
      },
      discardLocal: () => this.discardNeverSent(entry.orderId),
      resolveKeepPhone: () => this.keepPhone(entry.orderId),
      resolveKeepBoth: () => this.keepBoth(entry.orderId),
      release: () => {
        if (released) return;
        released = true;
        entry.refs = Math.max(0, entry.refs - 1);
        this.maybeForget(entry);
      },
    };
  }

  private attach(record: DraftRecord, refs: number, args?: OpenArgs): Entry {
    const orderId = record.orderId;
    const hasRecord = record.rev > 0;
    const pending: SaveRequest<EditorState> | null = record.inflight
      ? { requestId: record.inflight.requestId, expectedVersion: record.inflight.expectedVersion, state: record.inflight.state }
      : null;
    const entry: Entry = {
      orderId,
      machine: undefined as unknown as Autosave<EditorState, Order>,
      unsubscribe: () => undefined,
      refs,
      rev: hasRecord ? record.rev : null,
      seq: record.seq,
      storeId: record.state.storeId,
      lineInfo: record.lineInfo,
      tries: 0,
      timer: null,
      recovered: hasRecord && record.syncState !== "synced",
      lastStatus: "",
      forced: false,
    };
    entry.machine = createAutosave<EditorState, Order>(
      {
        send: (request) => this.send(entry, request),
        newId: this.deps.newId,
        debounceMs: this.deps.debounceMs,
        journal: { write: (snapshot) => this.writeJournal(entry, snapshot) },
        canSend: () => this.canSend(entry),
      },
      {
        state: record.state,
        version: record.baseVersion,
        savedAt: record.serverOrder?.updated_at ?? null,
        order: record.serverOrder ?? args?.serverOrder ?? null,
        // What the server has: the phone version when nothing is waiting, otherwise the server order (or nothing, for a new order).
        confirmed: record.syncState === "synced" ? record.state : record.serverOrder ? stateFromOrder(record.serverOrder) : emptyState(record.state.storeId),
        pending,
        conflict: record.conflict?.server ?? null,
      },
    );
    entry.unsubscribe = entry.machine.subscribe(() => this.onMachine(entry));
    this.entries.set(orderId, entry);
    return entry;
  }

  private maybeForget(entry: Entry): void {
    if (entry.refs > 0) return;
    const snap = entry.machine.getSnapshot();
    const resting = snap.status === "saved" || snap.status === "idle";
    if (resting && !snap.isDirty) {
      if (entry.timer !== null) this.deps.scheduler.clear(entry.timer);
      entry.unsubscribe();
      entry.machine.dispose();
      this.entries.delete(entry.orderId);
      this.emit();
    }
  }

  /** Keeps the phone version: the server's current order becomes the base and the phone version is sent again. */
  keepPhone(orderId: string): boolean {
    const entry = this.entries.get(orderId);
    const server = entry?.machine.getSnapshot().conflict;
    if (!entry || !server || server.status !== "draft") return false;
    const activeOnServer = new Set(server.lines.map((l) => l.id));
    const local = entry.machine.getLocalState();
    const info: Record<string, LineInfo> = {};
    const lines = local.lines.map((l) => {
      const id = activeOnServer.has(l.id) ? l.id : this.deps.newId();
      if (entry.lineInfo[l.id]) info[id] = entry.lineInfo[l.id]!;
      return id === l.id ? l : { ...l, id };
    });
    entry.lineInfo = info;
    entry.machine.edit({ ...local, lines });
    entry.machine.rebase(stateFromOrder(server), server.version, server);
    this.emit();
    void this.wake();
    return true;
  }

  /** Keeps both: the phone lines become a new draft with a new id (sent by the normal queue); the old order is left to the caller to adopt. */
  async keepBoth(orderId: string): Promise<string | null> {
    const record = await this.journal.get(orderId);
    if (!record) return null;
    const newOrderId = this.deps.newId();
    const copy = keepBothDraft(record, newOrderId, this.deps.newId, this.deps.nowText());
    const written = await this.journal.apply(newOrderId, null, () => copy);
    if (!written.ok) return null;
    this.attach(written.draft, 0);
    this.emit();
    void this.wake();
    return newOrderId;
  }

  /** Deletes an order that never reached the server. An order that exists on the server is never removed here. */
  async discardNeverSent(orderId: string): Promise<boolean> {
    const result = await this.journal.discardNeverSent(orderId);
    if (!result.ok) return false;
    const entry = this.entries.get(orderId);
    if (entry) {
      if (entry.timer !== null) this.deps.scheduler.clear(entry.timer);
      entry.unsubscribe();
      entry.machine.dispose();
      this.entries.delete(orderId);
      this.emit();
    }
    return true;
  }

  // ---------------------------------------------------------------- journal, sending

  private async writeJournal(entry: Entry, snapshot: DurableSnapshot<EditorState, Order>): Promise<void> {
    const result = await this.journal.apply(entry.orderId, entry.rev, (current) => {
      const base = current ?? emptyDraft(entry.orderId, snapshot.state, entry.lineInfo, this.deps.nowText());
      const syncState: SyncState = snapshot.conflict ? "conflict" : snapshot.synced ? "synced" : "on_device";
      return {
        ...base,
        state: snapshot.state,
        lineInfo: entry.lineInfo,
        baseVersion: snapshot.version,
        inflight: snapshot.pending ? { requestId: snapshot.pending.requestId, expectedVersion: snapshot.pending.expectedVersion, state: snapshot.pending.state } : null,
        serverOrder: snapshot.serverOrder,
        syncState,
        reason: null,
        conflict: snapshot.conflict ? { kind: "changed", message: "This order was changed elsewhere.", server: snapshot.conflict } : null,
        neverSent: snapshot.serverOrder === null && snapshot.version === null,
        updatedOnDevice: this.deps.nowText(),
      };
    });
    if (result.ok) {
      entry.rev = result.draft.rev;
      entry.seq = result.draft.seq;
      entry.storeId = result.draft.state.storeId;
      return;
    }
    if (result.reason === "rev_conflict") throw new Error(DEVICE_CONFLICT_MESSAGE);
    throw new Error(result.message);
  }

  private async send(entry: Entry, request: SaveRequest<EditorState>): Promise<SaveOutcome<Order>> {
    this.lastAttemptAt = this.deps.nowText();
    void this.deps.db.put("meta", { key: "lastSyncAttemptAt", value: this.lastAttemptAt }).catch(() => undefined);
    let result: SendResult;
    try {
      result = await this.deps.transport(entry.orderId, request);
    } catch {
      result = { kind: "retryable", message: "Can't reach the server. Check your connection and try again." };
    }
    if (result.kind === "unauthorized") {
      this.needsSignIn = true;
      this.emit();
      return { kind: "retryable", message: "Sign in again to send the waiting orders." };
    }
    if (result.kind === "ok") {
      this.needsSignIn = false;
      this.lastSyncAt = this.deps.nowText();
      void this.deps.db.put("meta", { key: "lastSyncAt", value: this.lastSyncAt }).catch(() => undefined);
    }
    return result;
  }

  /** The tab that holds the sender role sends everything; any other tab sends only the draft that is open on its own screen. */
  private canSendNow(ownDraftOpen = false, ignoreConnection = false): boolean {
    return !this.stopped && (ownDraftOpen || this.deps.election.isLeader()) && (ignoreConnection || this.deps.connectivity.getState() === "online") && !this.paused && !this.needsSignIn;
  }

  /** An order whose store is not on the server yet waits for it: it is never sent for another store. */
  private canSend(entry: Entry): boolean {
    return this.canSendNow(entry.refs > 0, entry.forced) && !this.storeOps.has(entry.storeId);
  }

  /** A machine changed: update the counts, schedule the next try after a failed one, forget a finished draft. */
  private onMachine(entry: Entry): void {
    const snap = entry.machine.getSnapshot();
    const status = snap.status;
    if (status !== entry.lastStatus) {
      entry.lastStatus = status;
      if (status === "on_device" && entry.timer === null && this.canSend(entry)) {
        entry.tries += 1;
        this.scheduleRetry(entry);
      }
      if (status === "saved") entry.tries = 0;
    }
    this.maybeForget(entry);
    this.emit();
  }

  private scheduleRetry(entry: Entry): void {
    if (entry.timer !== null || this.stopped) return;
    entry.timer = this.deps.scheduler.set(() => {
      entry.timer = null;
      void this.wake();
    }, nextDelayMs(entry.tries));
  }

  /** Sends the waiting drafts one after the other when sending is possible. */
  async wake(): Promise<void> {
    if (this.stopped) return;
    if (this.waking) {
      this.wakeAgain = true;
      return;
    }
    this.waking = true;
    try {
      do {
        this.wakeAgain = false;
        await this.sendStores();
        await this.sendPayments();
        const waiting = [...this.entries.values()]
          .filter((e) => e.timer === null && e.machine.getSnapshot().status === "on_device" && this.canSend(e))
          .sort((a, b) => a.seq - b.seq);
        for (const entry of waiting) {
          if (this.stopped || !this.canSend(entry)) break;
          entry.machine.retry();
          await entry.machine.flush().catch(() => undefined);
        }
      } while (this.wakeAgain && !this.stopped);
    } finally {
      this.waking = false;
    }
  }

  // ---------------------------------------------------------------- the supplier's controls

  /** The Retry button of one item (or of all when no id is given): tries now, without waiting for the backoff. */
  retry(orderId?: string): void {
    this.needsSignIn = false;
    for (const [id, op] of this.storeOps) {
      if (orderId !== undefined && id !== orderId) continue;
      const timer = this.storeTimers.get(id);
      if (timer !== undefined) {
        this.deps.scheduler.clear(timer);
        this.storeTimers.delete(id);
      }
      if (op.state === "failed" || op.state === "waiting") void this.saveOp({ ...op, state: "on_device", reason: null, tries: 0 });
    }
    for (const op of this.paymentList()) {
      if (orderId !== undefined && op.paymentId !== orderId) continue;
      const timer = this.paymentTimers.get(op.paymentId);
      if (timer !== undefined) {
        this.deps.scheduler.clear(timer);
        this.paymentTimers.delete(op.paymentId);
      }
      // A blanket Retry only hurries the payments that are waiting; a payment in conflict is retried only when the supplier chose it.
      if (op.state === "waiting" || (op.state === "conflict" && orderId !== undefined)) {
        if (orderId !== undefined) this.forcedPayments.add(op.paymentId);
        void this.savePayment({ ...op, state: "waiting", conflict: null, reason: null, tries: 0 });
      }
    }
    for (const e of this.entries.values()) {
      if (orderId !== undefined && e.orderId !== orderId) continue;
      if (e.timer !== null) {
        this.deps.scheduler.clear(e.timer);
        e.timer = null;
      }
      e.tries = 0;
      // Try now, even while the machine waits for its own short retry (the Retry button never makes the person wait).
      // The person's own Retry is always tried, even while the connection flag still says offline after an earlier failure.
      e.forced = orderId !== undefined;
      try {
        if (this.canSend(e)) e.machine.retry();
      } finally {
        e.forced = false;
      }
    }
    this.emit();
    void this.wake();
  }

  async pause(): Promise<void> {
    this.paused = true;
    await this.deps.db.put("meta", { key: "sendingPaused", value: true }).catch(() => undefined);
    this.emit();
  }

  async resume(): Promise<void> {
    this.paused = false;
    await this.deps.db.put("meta", { key: "sendingPaused", value: false }).catch(() => undefined);
    this.emit();
    void this.wake();
  }

  /** The same user signed in again: sending may continue. */
  signedIn(): void {
    this.needsSignIn = false;
    this.emit();
    void this.wake();
  }

  // ---------------------------------------------------------------- status

  getStatus(): SyncStatus {
    return this.status;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The machine of a draft the centre owns (for tests and for the conflict screens). */
  getMachine(orderId: string): Autosave<EditorState, Order> | undefined {
    return this.entries.get(orderId)?.machine;
  }

  private itemState(entry: Entry, snap: AutosaveSnapshot<EditorState, Order>): ItemState | null {
    // Kept on the phone and waiting for its store to be created first.
    if (this.storeOps.has(entry.storeId) && (snap.status === "on_device" || snap.status === "pending" || snap.status === "saving" || snap.isDirty)) return "blocked";
    switch (snap.status) {
      case "changed_elsewhere":
        return "conflict";
      case "saving":
        return "syncing";
      case "not_saved":
        return "failed";
      case "on_device":
      case "pending":
        return "waiting";
      default:
        return snap.isDirty ? "waiting" : null;
    }
  }

  private emit(): void {
    const items: SyncItem[] = [];
    const counts = { waiting: 0, syncing: 0, failed: 0, conflict: 0, blocked: 0 };
    for (const entry of [...this.entries.values()].sort((a, b) => a.seq - b.seq)) {
      const snap = entry.machine.getSnapshot();
      const state = this.itemState(entry, snap);
      if (state === null) continue;
      counts[state === "similar" ? "conflict" : state] += 1;
      items.push({
        kind: "order",
        orderId: entry.orderId,
        storeId: entry.storeId,
        name: null,
        matches: [],
        state,
        reason: snap.error,
        lines: snap.state.lines.length,
        neverSent: snap.serverOrder === null && snap.version === null,
        tries: entry.tries,
        payment: null,
      });
    }
    for (const op of [...this.storeOps.values()].sort((a, b) => a.seq - b.seq)) {
      const state: ItemState = op.state === "syncing" ? "syncing" : op.state === "failed" ? "failed" : op.state === "similar" ? "similar" : "waiting";
      counts[state === "similar" ? "conflict" : state] += 1;
      items.unshift({ kind: "store", orderId: op.storeId, storeId: op.storeId, name: op.payload.name, matches: op.matches, state, reason: op.reason, lines: 0, neverSent: true, tries: op.tries, payment: null });
    }
    const payments = { waiting: 0, syncing: 0, conflict: 0 };
    for (const op of this.paymentList()) {
      const state: ItemState = op.state === "syncing" ? "syncing" : op.state === "conflict" ? "conflict" : "waiting";
      counts[state] += 1;
      payments[state] += 1;
      items.push({
        kind: "payment",
        orderId: op.paymentId,
        storeId: op.storeId,
        name: null,
        matches: [],
        state,
        reason: op.reason,
        lines: 0,
        neverSent: !op.attempted,
        tries: op.tries,
        payment: { paymentId: op.paymentId, amount: op.amount, date: op.date, reference: op.reference, conflict: op.conflict, canRemove: canRemove(op), recordedOn: op.recordedOn },
      });
    }
    const totals = waitingTotals(this.paymentList());
    this.status = {
      online: this.deps.connectivity.getState() === "online",
      leader: this.deps.election.isLeader(),
      paused: this.paused,
      needsSignIn: this.needsSignIn,
      lastSyncAt: this.lastSyncAt,
      lastAttemptAt: this.lastAttemptAt,
      counts,
      pendingStoreIds: [...this.storeOps.keys()],
      items,
      payments,
      waitingTotal: { count: totals.count, paisa: totals.paisa },
      waitingByStore: totals.byStore,
    };
    for (const l of Array.from(this.listeners)) l();
  }

  // ---------------------------------------------------------------- cash payments recorded on the phone (Module 011)

  /** The waiting payments in the order they were recorded. */
  private paymentList(): PaymentOpRecord[] {
    return [...this.paymentOps.values()].sort((a, b) => a.seq - b.seq);
  }

  /** The waiting payments (a copy), for the screens that list them. */
  listPayments(): PaymentOpRecord[] {
    return this.paymentList().map((op) => ({ ...op }));
  }

  /**
   * Records a cash payment on the phone. It follows the same rules as the online form, is kept in the phone's storage first and
   * counts as nothing until the server confirms it. `paymentId` is the key the online form already holds when the person chooses
   * to keep that payment on the phone; the same key is never recorded twice. It refuses when the phone cannot keep the payment.
   */
  async recordPayment(args: { storeId: string; input: PaymentInput; paymentId?: string }): Promise<RecordPaymentResult> {
    const checked = validatePaymentInput(args.input, (this.deps.today ?? todayInPakistan)());
    if (!checked.ok) return { ok: false, reason: "invalid", fields: checked.fields };
    const paymentId = args.paymentId ?? this.deps.newId();
    try {
      await this.loadPayments(); // a payment recorded by another tab of this phone counts for the key and the order
    } catch {
      return { ok: false, reason: "storage", message: "This phone could not keep the payment, so nothing was recorded. Free some space and try again." };
    }
    if (this.paymentOps.has(paymentId)) return { ok: false, reason: "duplicate", message: "This payment is already waiting on this phone." };
    const payment = newPaymentOp({ paymentId, storeId: args.storeId, input: checked.value, seq: nextSeq(this.paymentList()), recordedOn: this.deps.nowText() });
    try {
      await this.deps.db.put("paymentOps", payment);
    } catch {
      return { ok: false, reason: "storage", message: "This phone could not keep the payment, so nothing was recorded. Free some space and try again." };
    }
    this.paymentOps.set(paymentId, payment);
    this.emit();
    void this.wake();
    return { ok: true, payment: { ...payment } };
  }

  /** Writes a change of a waiting payment (one revision up). The in-memory state still drives sending if the write fails. */
  private async savePayment(op: PaymentOpRecord): Promise<void> {
    if (!this.paymentOps.has(op.paymentId)) return; // removed in the meantime
    const next = { ...op, rev: op.rev + 1 };
    this.paymentOps.set(op.paymentId, next);
    try {
      await this.deps.db.put("paymentOps", next);
    } catch {
      // The next successful write keeps it.
    }
    this.emit();
    void this.wake();
  }

  /**
   * Sends the waiting payments one at a time, in the order recorded, after the stores they may depend on. Before each request the
   * attempt is written to the phone, so after a restart the same request (same key) is sent again and the server records it once.
   * A payment is never sent from a tab that is not the sender, while sending is paused or a sign-in is needed, or for a store that
   * is still waiting on the phone.
   */
  private async sendPayments(): Promise<void> {
    const transport = this.deps.paymentTransport;
    if (!transport) return;
    try {
      await this.loadPayments(); // payments recorded by another tab of this phone
    } catch {
      return;
    }
    for (;;) {
      const op = dueNow(this.paymentList(), { pendingStoreIds: new Set(this.storeOps.keys()), retryingIds: new Set(this.paymentTimers.keys()) }).find((p) => {
        const forced = this.forcedPayments.has(p.paymentId);
        return this.canSendNow(forced, forced);
      });
      if (!op) return;
      this.forcedPayments.delete(op.paymentId);

      // Another tab may have sent or changed this payment since this tab read it: the phone's storage has the latest word.
      let stored: PaymentOpRecord | undefined = op;
      try {
        stored = await this.deps.db.get("paymentOps", op.paymentId);
      } catch {
        stored = op;
      }
      if (stored === undefined) {
        this.paymentOps.delete(op.paymentId);
        this.emit();
        continue;
      }
      if (stored.rev > op.rev || stored.state === "conflict") {
        this.paymentOps.set(stored.paymentId, stored.state === "syncing" ? { ...stored, state: "waiting" } : stored);
        this.emit();
        continue;
      }

      const attempt: PaymentOpRecord = { ...stored, attempted: true, state: "syncing", rev: stored.rev + 1 };
      try {
        await this.deps.db.put("paymentOps", attempt);
      } catch {
        // The attempt could not be written, so nothing is sent: a request must never go out without a record of it.
        this.holdForRetry(stored, "This phone could not save the attempt, so the payment was not sent yet.");
        continue;
      }
      if (!this.paymentOps.has(op.paymentId)) {
        await this.deps.db.remove("paymentOps", op.paymentId).catch(() => undefined); // removed while the attempt was written
        continue;
      }
      this.paymentOps.set(attempt.paymentId, attempt);
      this.lastAttemptAt = this.deps.nowText();
      void this.deps.db.put("meta", { key: "lastSyncAttemptAt", value: this.lastAttemptAt }).catch(() => undefined);
      this.emit();

      let result: PaymentSendResult;
      try {
        result = await transport(attempt);
      } catch {
        result = { kind: "retryable", message: "Can't reach the server. Check your connection and try again." };
      }
      const current = this.paymentOps.get(attempt.paymentId);
      if (!current) continue;
      if (result.kind === "ok") {
        this.needsSignIn = false;
        this.paymentOps.delete(attempt.paymentId);
        this.lastSyncAt = this.deps.nowText();
        void this.deps.db.put("meta", { key: "lastSyncAt", value: this.lastSyncAt }).catch(() => undefined);
        // If the removal fails the payment comes back after a restart and is sent once more: the server answers "replayed".
        this.removingPayments.add(attempt.paymentId); // so a reload of the storage cannot bring it back while it is being removed
        try {
          await this.deps.db.remove("paymentOps", attempt.paymentId);
        } catch {
          // kept on the phone; sent again later
        } finally {
          this.removingPayments.delete(attempt.paymentId);
        }
        this.emit();
      } else if (result.kind === "conflict") {
        await this.writePayment({ ...current, state: "conflict", conflict: result.conflict, reason: result.message });
      } else if (result.kind === "unauthorized") {
        this.needsSignIn = true;
        await this.writePayment({ ...current, state: "waiting", reason: "Sign in again to send the waiting payments." });
      } else {
        this.holdForRetry(current, result.message, true);
      }
    }
  }

  /** Stores a change without waking the sender (the sender is already running). */
  private async writePayment(op: PaymentOpRecord): Promise<void> {
    if (!this.paymentOps.has(op.paymentId)) return;
    const next = { ...op, rev: op.rev + 1 };
    this.paymentOps.set(op.paymentId, next);
    try {
      await this.deps.db.put("paymentOps", next);
    } catch {
      // The in-memory state still drives sending; the next successful write keeps it.
    }
    this.emit();
  }

  /** The payment waits for its next try (2 s, 5 s, 15 s, 45 s, then 2 minutes); later payments of its own store wait behind it. */
  private holdForRetry(op: PaymentOpRecord, reason: string, persist = false): void {
    const tries = op.tries + 1;
    const next = { ...op, state: "waiting" as const, reason, tries, rev: persist ? op.rev + 1 : op.rev };
    this.paymentOps.set(op.paymentId, next);
    if (persist) void this.deps.db.put("paymentOps", next).catch(() => undefined);
    const timer = this.paymentTimers.get(op.paymentId);
    if (timer !== undefined) this.deps.scheduler.clear(timer);
    this.paymentTimers.set(
      op.paymentId,
      this.deps.scheduler.set(() => {
        this.paymentTimers.delete(op.paymentId);
        void this.wake();
      }, nextDelayMs(tries)),
    );
    this.emit();
  }

  /**
   * After the server refused a payment's details (the amount, the date or the reference), the supplier may correct them and send it
   * again with the same key. Nothing was recorded by the refused request, so the same key is safe. Not offered for any other refusal.
   */
  async correctAndResend(paymentId: string, input: PaymentInput): Promise<{ ok: true } | { ok: false; fields: PaymentFields } | { ok: false; message: string }> {
    const op = this.paymentOps.get(paymentId);
    if (!op || op.state !== "conflict" || op.conflict !== "refused") return { ok: false, message: "This payment cannot be corrected here." };
    const checked = validatePaymentInput(input, (this.deps.today ?? todayInPakistan)());
    if (!checked.ok) return { ok: false, fields: checked.fields };
    this.needsSignIn = false;
    this.forcedPayments.add(paymentId);
    await this.savePayment({ ...op, amount: checked.value.amount, date: checked.value.date, reference: checked.value.reference, state: "waiting", conflict: null, reason: null, tries: 0 });
    return { ok: true };
  }

  /**
   * Removes a payment from the phone after the supplier confirmed it (the caller names the amount and the store). False when it
   * cannot be removed: a payment that was sent and has no answer may already be on the server, so it can only be sent again.
   */
  async removePayment(paymentId: string): Promise<boolean> {
    const op = this.paymentOps.get(paymentId);
    if (!op || !canRemove(op)) return false;
    this.paymentOps.delete(paymentId); // first, so the sender cannot pick it up while the storage is written
    this.removingPayments.add(paymentId);
    try {
      await this.deps.db.remove("paymentOps", paymentId);
    } catch {
      this.paymentOps.set(paymentId, op);
      this.emit();
      return false;
    } finally {
      this.removingPayments.delete(paymentId);
    }
    const timer = this.paymentTimers.get(paymentId);
    if (timer !== undefined) this.deps.scheduler.clear(timer);
    this.paymentTimers.delete(paymentId);
    this.emit();
    return true;
  }

  // ---------------------------------------------------------------- stores made on the phone (US4)

  /** Makes a store on the phone: selectable at once, created on the server by the queue before the orders that use it. */
  async createStore(input: { name: string; contact_person?: string | null; phone?: string | null; address?: string | null }): Promise<StoredStore | null> {
    const name = input.name.replace(/\s+/g, " ").trim();
    if (name === "") return null;
    const id = this.deps.newId();
    const seq = Math.max(0, ...[...this.storeOps.values()].map((o) => o.seq)) + 1;
    const op: StoreOpRecord = {
      storeId: id,
      rev: 1,
      seq,
      payload: { id, name, contact_person: input.contact_person ?? null, phone: input.phone ?? null, address: input.address ?? null, notes: null },
      confirmDuplicate: false,
      state: "on_device",
      reason: null,
      matches: [],
      tries: 0,
      nextTryTick: 0,
    };
    const store: StoredStore = { id, name, contact_person: op.payload.contact_person, phone: op.payload.phone, address: op.payload.address, is_active: true, pending: true };
    try {
      await this.deps.db.batch([
        { op: "put", store: "storeOps", value: op },
        { op: "put", store: "stores", value: store },
      ]);
    } catch {
      return null;
    }
    this.storeOps.set(id, op);
    this.emit();
    void this.wake();
    return store;
  }

  private async saveOp(op: StoreOpRecord): Promise<void> {
    const next = { ...op, rev: op.rev + 1 };
    this.storeOps.set(op.storeId, next);
    try {
      await this.deps.db.put("storeOps", next);
    } catch {
      // The in-memory state still drives sending; the next successful write keeps it.
    }
    this.emit();
    void this.wake();
  }

  /** Sends the stores made on the phone, one at a time, before any order that uses them. */
  private async sendStores(): Promise<void> {
    const transport = this.deps.storeTransport;
    if (!transport) return;
    const due = [...this.storeOps.values()].filter((o) => (o.state === "on_device" || o.state === "waiting") && !this.storeTimers.has(o.storeId)).sort((a, b) => a.seq - b.seq);
    for (const op of due) {
      if (!this.canSendNow()) return;
      this.storeOps.set(op.storeId, { ...op, state: "syncing" });
      this.emit();
      let result: StoreSendResult;
      try {
        result = await transport(op.payload, op.confirmDuplicate);
      } catch {
        result = { kind: "retryable", message: "Can't reach the server. Check your connection and try again." };
      }
      const current = this.storeOps.get(op.storeId);
      if (!current) continue; // the supplier resolved it while it was being sent
      if (result.kind === "ok") {
        this.needsSignIn = false;
        this.storeOps.delete(op.storeId);
        try {
          await this.deps.db.batch([
            { op: "remove", store: "storeOps", key: op.storeId },
            { op: "put", store: "stores", value: { id: op.payload.id, name: op.payload.name, contact_person: op.payload.contact_person, phone: op.payload.phone, address: op.payload.address, is_active: true, pending: false } },
          ]);
        } catch {
          // The server has the store; the row is corrected by the next refresh of the lists.
        }
        this.emit();
      } else if (result.kind === "similar") {
        await this.saveOp({ ...current, state: "similar", matches: result.matches, reason: null });
      } else if (result.kind === "fatal") {
        await this.saveOp({ ...current, state: "failed", reason: result.message });
      } else if (result.kind === "unauthorized") {
        this.needsSignIn = true;
        await this.saveOp({ ...current, state: "waiting", reason: "Sign in again to send the waiting orders." });
      } else {
        const tries = current.tries + 1;
        this.storeOps.set(op.storeId, { ...current, state: "waiting", reason: result.message, tries });
        this.storeTimers.set(
          op.storeId,
          this.deps.scheduler.set(() => {
            this.storeTimers.delete(op.storeId);
            void this.wake();
          }, nextDelayMs(tries)),
        );
        this.emit();
      }
    }
  }

  /**
   * The supplier's answer when the server found a store with a similar name. "use_existing" moves the waiting orders to that
   * store and forgets the new one; "create_anyway" creates it with the duplicate confirmed. Nothing happens before this call.
   */
  async resolveSimilar(storeId: string, answer: { choice: "use_existing"; existingId: string } | { choice: "create_anyway" }): Promise<boolean> {
    const op = this.storeOps.get(storeId);
    if (!op) return false;
    if (answer.choice === "create_anyway") {
      await this.saveOp({ ...op, confirmDuplicate: true, state: "on_device", reason: null, matches: [] });
      return true;
    }
    for (const entry of this.entries.values()) {
      if (entry.storeId !== storeId) continue;
      const local = entry.machine.getLocalState();
      entry.storeId = answer.existingId;
      entry.machine.edit({ ...local, storeId: answer.existingId });
    }
    this.storeOps.delete(storeId);
    // The payments waiting for this store go to the existing store in the same step as the store's removal.
    const before = this.paymentList();
    const moved = remapStore(before, storeId, answer.existingId)
      .filter((p, i) => p !== before[i])
      .map((p) => ({ ...p, rev: p.rev + 1 }));
    for (const p of moved) this.paymentOps.set(p.paymentId, p);
    try {
      await this.deps.db.batch([
        { op: "remove", store: "storeOps", key: storeId },
        { op: "remove", store: "stores", key: storeId },
        ...moved.map((p) => ({ op: "put" as const, store: "paymentOps" as const, value: p })),
      ]);
    } catch {
      return false;
    }
    this.emit();
    void this.wake();
    return true;
  }
}
