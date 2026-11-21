// The real IndexedDB implementation of DeviceStorage (Module 009, plan D2). It is a plain mapping of the interface in
// schema.ts: one transaction per write, the `rev` check and the list replacements happen inside a transaction, and any
// failure (quota, blocked, closed) rejects or comes back as a plain `unavailable` result, never as an exception that escapes
// open. Vitest has no IndexedDB, so its behaviour is proven by the offline browser tests; the same contract is unit-tested
// on the in-memory implementation in tests/helpers/memory-storage.ts.

import {
  businessDbName,
  KEY_PATH,
  REGISTRY_DB_NAME,
  SCHEMA_UPGRADES,
  SCHEMA_VERSION,
  type BatchOp,
  type BusinessDatabase,
  type DeviceStorage,
  type DraftRecord,
  type OpenResult,
  type PutDraftResult,
  type RegistryEntry,
  type StoreMap,
  type StoreName,
  type StoredMedicine,
  type StoredStore,
} from "./schema";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function openDatabase(factory: IDBFactory, name: string, version: number, upgrade: (db: IDBDatabase, oldVersion: number) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, version);
    req.onupgradeneeded = (event) => upgrade(req.result, event.oldVersion);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB open was blocked"));
  });
}

class IdbBusinessDatabase implements BusinessDatabase {
  constructor(
    private readonly db: IDBDatabase,
    readonly businessId: string,
  ) {}

  async get<S extends StoreName>(store: S, key: string): Promise<StoreMap[S] | undefined> {
    const tx = this.db.transaction(store, "readonly");
    const value = await request(tx.objectStore(store).get(key));
    return value as StoreMap[S] | undefined;
  }

  async getAll<S extends StoreName>(store: S): Promise<StoreMap[S][]> {
    const tx = this.db.transaction(store, "readonly");
    return (await request(tx.objectStore(store).getAll())) as StoreMap[S][];
  }

  async put<S extends StoreName>(store: S, value: StoreMap[S]): Promise<void> {
    const tx = this.db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    await done(tx);
  }

  async remove(store: StoreName, key: string): Promise<void> {
    const tx = this.db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    await done(tx);
  }

  async batch(ops: BatchOp[]): Promise<void> {
    if (ops.length === 0) return;
    const names = [...new Set(ops.map((o) => o.store))];
    const tx = this.db.transaction(names, "readwrite");
    for (const op of ops) {
      const store = tx.objectStore(op.store);
      if (op.op === "put") store.put(op.value);
      else store.delete(op.key);
    }
    await done(tx);
  }

  async putDraftIfRev(draft: DraftRecord, expectedRev: number | null): Promise<PutDraftResult> {
    const tx = this.db.transaction("drafts", "readwrite");
    const store = tx.objectStore("drafts");
    const stored = (await request(store.get(draft.orderId))) as DraftRecord | undefined;
    const storedRev = stored ? stored.rev : null;
    if (storedRev !== expectedRev) {
      tx.abort();
      await done(tx).catch(() => undefined);
      return { ok: false, stored: stored ?? null };
    }
    store.put(draft);
    await done(tx);
    return { ok: true };
  }

  async replaceMedicines(rows: StoredMedicine[], updatedAt: string): Promise<void> {
    const tx = this.db.transaction(["medicines", "meta"], "readwrite");
    const store = tx.objectStore("medicines");
    store.clear();
    for (const row of rows) store.put(row);
    tx.objectStore("meta").put({ key: "medicinesUpdatedAt", value: updatedAt });
    await done(tx);
  }

  async replaceStores(rows: StoredStore[], updatedAt: string): Promise<void> {
    const tx = this.db.transaction(["stores", "meta"], "readwrite");
    const store = tx.objectStore("stores");
    const existing = (await request(store.getAll())) as StoredStore[];
    const pending = existing.filter((s) => s.pending);
    const pendingIds = new Set(pending.map((s) => s.id));
    store.clear();
    for (const row of rows) if (!pendingIds.has(row.id)) store.put({ ...row, pending: false });
    for (const row of pending) store.put(row);
    tx.objectStore("meta").put({ key: "storesUpdatedAt", value: updatedAt });
    await done(tx);
  }

  close(): void {
    this.db.close();
  }
}

export function createIndexedDbStorage(factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB): DeviceStorage {
  const open = new Map<string, IdbBusinessDatabase>();

  function registry(): Promise<IDBDatabase> {
    if (!factory) return Promise.reject(new Error("IndexedDB is not available"));
    return openDatabase(factory, REGISTRY_DB_NAME, 1, (db) => {
      if (!db.objectStoreNames.contains("users")) db.createObjectStore("users", { keyPath: "userId" });
    });
  }

  async function withRegistry<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    const db = await registry();
    try {
      const tx = db.transaction("users", mode);
      const result = await work(tx.objectStore("users"));
      if (mode === "readwrite") await done(tx);
      return result;
    } finally {
      db.close();
    }
  }

  return {
    available: factory !== undefined,

    async openBusiness(businessId: string): Promise<OpenResult> {
      if (!factory) return { ok: false, reason: "unavailable", message: "This browser cannot keep offline data." };
      const name = businessDbName(businessId);
      try {
        const db = await openDatabase(factory, name, SCHEMA_VERSION, (database, oldVersion) => {
          for (let v = oldVersion + 1; v <= SCHEMA_VERSION; v += 1) {
            for (const store of SCHEMA_UPGRADES[v] ?? []) {
              if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: KEY_PATH[store] });
            }
          }
        });
        const wrapped = new IdbBusinessDatabase(db, businessId);
        open.set(name, wrapped);
        return { ok: true, db: wrapped };
      } catch (error) {
        if (error instanceof DOMException && error.name === "VersionError") {
          return { ok: false, reason: "newer_schema", message: "This phone holds data from a newer version of the app." };
        }
        return { ok: false, reason: "unavailable", message: "This browser cannot keep offline data here (a private window, blocked or full storage)." };
      }
    },

    async deleteBusiness(businessId: string): Promise<void> {
      if (!factory) return;
      const name = businessDbName(businessId);
      open.get(name)?.close();
      open.delete(name);
      await new Promise<void>((resolve, reject) => {
        const req = factory.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error("Could not delete the device data"));
        req.onblocked = () => reject(new Error("The device data is in use by another tab. Close the other tabs and try again."));
      });
    },

    getRegistryEntry: (userId) => withRegistry("readonly", async (store) => (await request(store.get(userId))) as RegistryEntry | undefined),
    putRegistryEntry: (entry) => withRegistry("readwrite", async (store) => void store.put(entry)),
    removeRegistryEntry: (userId) => withRegistry("readwrite", async (store) => void store.delete(userId)),
    listRegistry: () => withRegistry("readonly", async (store) => (await request(store.getAll())) as RegistryEntry[]),
  };
}
