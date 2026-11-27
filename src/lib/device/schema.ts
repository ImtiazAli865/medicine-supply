// Types and constants of the device storage (Module 009). Pure: no browser call is made here, so the same
// definitions are used by the real IndexedDB implementation (db.ts) and by the in-memory one used in unit tests.
// See specs/009-offline-sync-backup/data-model.md.

import { isUuid } from "@/lib/ids";
import type { EditorState, LineInfo } from "@/lib/orders/editor-state";
import type { RepeatPlan, SlimMedicine, UsualResponse } from "@/lib/orders/fast-types";
import type { Order } from "@/lib/orders/types";

export const SCHEMA_VERSION = 3;

export const REGISTRY_DB_NAME = "medsupply-registry";

/** The database of one business. The name is built from the business id only, so one business cannot open another's. */
export function businessDbName(businessId: string): string {
  if (!isUuid(businessId)) throw new Error("A business database needs a valid business id.");
  return `medsupply-${businessId.toLowerCase()}`;
}

/** Object stores created by each schema version (an upgrade step exists for every version up to SCHEMA_VERSION). */
export const SCHEMA_UPGRADES: Record<number, readonly StoreName[]> = {
  1: ["meta", "medicines", "stores", "storeExtras", "drafts", "storeOps"],
  // Version 2 (Module 011) adds the queue of cash payments recorded without the internet. Existing data is untouched.
  2: ["paymentOps"],
  // Version 3 (Module 012) adds each store's own selling prices, for orders taken without the internet.
  3: ["storeRates"],
};

export type StoreName = "meta" | "medicines" | "stores" | "storeExtras" | "drafts" | "storeOps" | "paymentOps" | "storeRates";

export type SyncState = "on_device" | "waiting" | "syncing" | "synced" | "failed" | "conflict" | "blocked";

export type ConflictKind = "changed" | "not_editable" | "missing" | "line_problem" | "store_problem";

export interface ConflictRecord {
  kind: ConflictKind;
  /** A plain sentence for the supplier. */
  message: string;
  /** The server's order when the server returned it (null when the order is missing). */
  server: Order | null;
}

/** The request that has been (or is about to be) sent and has no answer yet. Kept so a retry repeats it exactly. */
export interface InflightRequest {
  requestId: string;
  expectedVersion: number | null;
  state: EditorState;
}

export interface DraftRecord {
  orderId: string;
  /** Incremented by every journal write; a write is applied only if the stored rev is the one the writer read. */
  rev: number;
  /** Order in which the draft was first changed while waiting; sends follow it. */
  seq: number;
  /** The phone version. */
  state: EditorState;
  lineInfo: Record<string, LineInfo>;
  /** The server version the phone version is based on; null before the first server save. */
  baseVersion: number | null;
  inflight: InflightRequest | null;
  /** The last order the server returned, for display and conflict comparison. */
  serverOrder: Order | null;
  syncState: SyncState;
  reason: string | null;
  conflict: ConflictRecord | null;
  /** Sender attempts so far for the current unresolved request (drives the backoff). */
  tries: number;
  /** The sender tick after which the next try is due (a counter, never the clock). */
  nextTryTick: number;
  /** True while the order has never reached the server. */
  neverSent: boolean;
  /** Display only: when the phone version last changed (never used for a decision). */
  updatedOnDevice: string;
}

export type StoreOpState = "on_device" | "waiting" | "syncing" | "synced" | "failed" | "similar";

export interface StoreOpPayload {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
}

export interface StoreOpRecord {
  storeId: string;
  rev: number;
  seq: number;
  payload: StoreOpPayload;
  confirmDuplicate: boolean;
  state: StoreOpState;
  reason: string | null;
  /** Stores the server found with a similar name (state "similar"). */
  matches: Array<{ id: string; name: string }>;
  tries: number;
  nextTryTick: number;
}

export type PaymentOpState = "on_device" | "syncing" | "waiting" | "conflict";

/** Why the server refused a payment (shown on the conflict card). */
export type PaymentConflictKind = "not_found" | "request_reused" | "refused";

/**
 * A cash payment recorded on the phone and not yet confirmed by the server (Module 011). It holds only what the person typed:
 * no balance, invoice, ledger entry or allocation is ever kept. A confirmed payment is removed, so `synced` is never stored.
 */
export interface PaymentOpRecord {
  /** Made on the phone once; it is the ledger entry id and the request id, so sending twice records one payment. */
  paymentId: string;
  /** Incremented by every write; a write is applied only if the stored rev is the one the writer read. */
  rev: number;
  /** Order in which the payment was recorded; sending follows it. */
  seq: number;
  storeId: string;
  /** Canonical two-decimal text, above zero. */
  amount: string;
  /** YYYY-MM-DD, not in the future and not before 2000-01-01. */
  date: string;
  reference: string | null;
  state: PaymentOpState;
  /** A plain sentence for the supplier. */
  reason: string | null;
  conflict: PaymentConflictKind | null;
  /** Written true before the first send; an attempted payment without an answer can never be removed from the phone. */
  attempted: boolean;
  tries: number;
  /** The sender tick after which the next try is due (a counter, never the clock). */
  nextTryTick: number;
  /** Display only: when it was recorded on the phone. */
  recordedOn: string;
}

export interface StoredStore {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
  /** True for a store made on this device and not yet created on the server. */
  pending: boolean;
}

export interface StoreExtras {
  storeId: string;
  usual: UsualResponse;
  repeatPlan: RepeatPlan | null;
  updatedAt: string;
}

/** Medicines are stored exactly in the slim shape of Module 008: no purchase price, MRP or cost, ever. */
export type StoredMedicine = SlimMedicine;

/** One store's own selling price for a medicine (Module 012): selling prices only. */
export interface StoredRate {
  /** `storeId:productId`. */
  key: string;
  storeId: string;
  productId: string;
  rate: string;
  version: number;
  catalogPriceAtSet: string | null;
}

export interface MetaMap {
  schemaVersion: number;
  ratesUpdatedAt: string;
  medicinesUpdatedAt: string;
  storesUpdatedAt: string;
  lastSyncAt: string;
  lastSyncAttemptAt: string;
  journalSeq: number;
  deviceId: string;
  recentStores: string[];
  sendingPaused: boolean;
}

export type MetaKey = keyof MetaMap;

export interface MetaRecord<K extends MetaKey = MetaKey> {
  key: K;
  value: MetaMap[K];
}

export interface StoreMap {
  meta: MetaRecord;
  medicines: StoredMedicine;
  stores: StoredStore;
  storeExtras: StoreExtras;
  drafts: DraftRecord;
  storeOps: StoreOpRecord;
  paymentOps: PaymentOpRecord;
  storeRates: StoredRate;
}

/** The key of each store's records (what `get` and `remove` take). */
export const KEY_PATH: Record<StoreName, string> = {
  meta: "key",
  medicines: "id",
  stores: "id",
  storeExtras: "storeId",
  drafts: "orderId",
  storeOps: "storeId",
  paymentOps: "paymentId",
  storeRates: "key",
};

export type BatchOp =
  | { op: "put"; store: StoreName; value: StoreMap[StoreName] }
  | { op: "remove"; store: StoreName; key: string };

export type PutDraftResult = { ok: true } | { ok: false; stored: DraftRecord | null };

/** One business's database. */
export interface BusinessDatabase {
  readonly businessId: string;
  get<S extends StoreName>(store: S, key: string): Promise<StoreMap[S] | undefined>;
  getAll<S extends StoreName>(store: S): Promise<StoreMap[S][]>;
  put<S extends StoreName>(store: S, value: StoreMap[S]): Promise<void>;
  remove(store: StoreName, key: string): Promise<void>;
  /** All operations apply or none do. */
  batch(ops: BatchOp[]): Promise<void>;
  /** Writes the draft only when the stored rev equals `expectedRev` (null means no stored draft). */
  putDraftIfRev(draft: DraftRecord, expectedRev: number | null): Promise<PutDraftResult>;
  /** Replaces every medicine in one atomic step (an interrupted refresh leaves the previous list). */
  replaceMedicines(rows: StoredMedicine[], updatedAt: string): Promise<void>;
  /** Replaces every non-pending store in one atomic step; stores made on this device that are still pending stay. */
  replaceStores(rows: StoredStore[], updatedAt: string): Promise<void>;
  close(): void;
}

export interface RegistryEntry {
  userId: string;
  businessId: string;
  businessName: string;
  /** Display only. */
  lastSignedInAt: string;
}

export type OpenResult = { ok: true; db: BusinessDatabase } | { ok: false; reason: "unavailable" | "newer_schema"; message: string };

/** Everything the app needs from the device's storage. */
export interface DeviceStorage {
  /** False when the browser cannot keep data (no IndexedDB, a private window, a blocked or full store). */
  readonly available: boolean;
  openBusiness(businessId: string): Promise<OpenResult>;
  deleteBusiness(businessId: string): Promise<void>;
  getRegistryEntry(userId: string): Promise<RegistryEntry | undefined>;
  putRegistryEntry(entry: RegistryEntry): Promise<void>;
  removeRegistryEntry(userId: string): Promise<void>;
  listRegistry(): Promise<RegistryEntry[]>;
}
