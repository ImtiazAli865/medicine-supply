// An in-memory DeviceStorage for unit tests (Module 009). It follows the same contract as the real IndexedDB
// implementation (src/lib/device/db.ts): records are copied in and out like IndexedDB's structured clone, a batch is
// all-or-nothing, a draft write is refused when the stored rev is not the expected one, and the medicine list is
// replaced in one step. `failWrites` and `failAfterWrites` let a test make the storage fail (for example a full disk).

import { businessDbName, KEY_PATH, SCHEMA_VERSION } from "@/lib/device/schema";
import type {
  BatchOp,
  BusinessDatabase,
  DeviceStorage,
  DraftRecord,
  OpenResult,
  PutDraftResult,
  RegistryEntry,
  StoreMap,
  StoreName,
  StoredMedicine,
  StoredStore,
} from "@/lib/device/schema";

type Tables = Map<StoreName, Map<string, unknown>>;

const STORE_NAMES = Object.keys(KEY_PATH) as StoreName[];

function emptyTables(): Tables {
  return new Map(STORE_NAMES.map((name) => [name, new Map<string, unknown>()]));
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function keyOf(store: StoreName, value: unknown): string {
  return String((value as Record<string, unknown>)[KEY_PATH[store]]);
}

export class MemoryDeviceStorage implements DeviceStorage {
  available = true;
  /** When true every write fails (a full or blocked store). */
  failWrites = false;
  /** When set to n, the n-th write operation from now on fails (to test all-or-nothing). */
  failAfterWrites: number | null = null;
  private readonly businesses = new Map<string, Tables>();
  private readonly registry = new Map<string, RegistryEntry>();
  private readonly open = new Set<MemoryBusinessDatabase>();

  /** A newer schema than this app knows (to test the refusal). */
  newerSchemaFor = new Set<string>();

  async openBusiness(businessId: string): Promise<OpenResult> {
    const name = businessDbName(businessId);
    if (!this.available) return { ok: false, reason: "unavailable", message: "This browser cannot keep offline data." };
    if (this.newerSchemaFor.has(name)) {
      return { ok: false, reason: "newer_schema", message: "This phone holds data from a newer version of the app." };
    }
    let tables = this.businesses.get(name);
    if (!tables) {
      tables = emptyTables();
      tables.get("meta")!.set("schemaVersion", { key: "schemaVersion", value: SCHEMA_VERSION });
      this.businesses.set(name, tables);
    }
    const db = new MemoryBusinessDatabase(this, businessId, tables);
    this.open.add(db);
    return { ok: true, db };
  }

  async deleteBusiness(businessId: string): Promise<void> {
    this.businesses.delete(businessDbName(businessId));
  }

  hasBusiness(businessId: string): boolean {
    return this.businesses.has(businessDbName(businessId));
  }

  async getRegistryEntry(userId: string): Promise<RegistryEntry | undefined> {
    const entry = this.registry.get(userId);
    return entry ? copy(entry) : undefined;
  }

  async putRegistryEntry(entry: RegistryEntry): Promise<void> {
    this.registry.set(entry.userId, copy(entry));
  }

  async removeRegistryEntry(userId: string): Promise<void> {
    this.registry.delete(userId);
  }

  async listRegistry(): Promise<RegistryEntry[]> {
    return [...this.registry.values()].map(copy);
  }

  /** Counts one write operation and throws when a failure is armed. */
  tickWrite(): void {
    if (this.failWrites) throw new Error("QuotaExceededError");
    if (this.failAfterWrites !== null) {
      this.failAfterWrites -= 1;
      if (this.failAfterWrites <= 0) {
        this.failAfterWrites = null;
        throw new Error("WriteFailedError");
      }
    }
  }
}

class MemoryBusinessDatabase implements BusinessDatabase {
  constructor(
    private readonly owner: MemoryDeviceStorage,
    readonly businessId: string,
    private readonly tables: Tables,
  ) {}

  private table(store: StoreName): Map<string, unknown> {
    return this.tables.get(store)!;
  }

  async get<S extends StoreName>(store: S, key: string): Promise<StoreMap[S] | undefined> {
    const value = this.table(store).get(key);
    return value === undefined ? undefined : (copy(value) as StoreMap[S]);
  }

  async getAll<S extends StoreName>(store: S): Promise<StoreMap[S][]> {
    return [...this.table(store).values()].map((v) => copy(v) as StoreMap[S]);
  }

  async put<S extends StoreName>(store: S, value: StoreMap[S]): Promise<void> {
    this.owner.tickWrite();
    this.table(store).set(keyOf(store, value), copy(value));
  }

  async remove(store: StoreName, key: string): Promise<void> {
    this.owner.tickWrite();
    this.table(store).delete(key);
  }

  async batch(ops: BatchOp[]): Promise<void> {
    // Work on a copy of the touched tables and swap them in only when every operation worked.
    const staged = new Map<StoreName, Map<string, unknown>>();
    const stage = (store: StoreName) => {
      if (!staged.has(store)) staged.set(store, new Map(this.table(store)));
      return staged.get(store)!;
    };
    for (const op of ops) {
      this.owner.tickWrite();
      if (op.op === "put") stage(op.store).set(keyOf(op.store, op.value), copy(op.value));
      else stage(op.store).delete(op.key);
    }
    for (const [store, map] of staged) this.tables.set(store, map);
  }

  async putDraftIfRev(draft: DraftRecord, expectedRev: number | null): Promise<PutDraftResult> {
    const stored = this.table("drafts").get(draft.orderId) as DraftRecord | undefined;
    const storedRev = stored ? stored.rev : null;
    if (storedRev !== expectedRev) return { ok: false, stored: stored ? copy(stored) : null };
    this.owner.tickWrite();
    this.table("drafts").set(draft.orderId, copy(draft));
    return { ok: true };
  }

  async replaceMedicines(rows: StoredMedicine[], updatedAt: string): Promise<void> {
    const next = new Map<string, unknown>();
    for (const row of rows) {
      this.owner.tickWrite();
      next.set(row.id, copy(row));
    }
    this.owner.tickWrite();
    this.tables.set("medicines", next);
    this.table("meta").set("medicinesUpdatedAt", { key: "medicinesUpdatedAt", value: updatedAt });
  }

  async replaceStores(rows: StoredStore[], updatedAt: string): Promise<void> {
    const next = new Map<string, unknown>();
    for (const [id, value] of this.table("stores")) if ((value as StoredStore).pending) next.set(id, value);
    for (const row of rows) {
      this.owner.tickWrite();
      if (!next.has(row.id)) next.set(row.id, copy({ ...row, pending: false }));
    }
    this.owner.tickWrite();
    this.tables.set("stores", next);
    this.table("meta").set("storesUpdatedAt", { key: "storesUpdatedAt", value: updatedAt });
  }

  close(): void {
    // Nothing to release in memory.
  }
}
