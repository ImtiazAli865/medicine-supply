import { describe, expect, it } from "vitest";
import { MemoryDeviceStorage } from "../helpers/memory-storage";
import { FRESH_MS, noteStoreOpened, readCacheAge, refreshDeviceCopy, STALE_MS, type CacheTransport } from "@/lib/device/cache";
import { answerLocal } from "@/lib/device/local-api";
import type { BusinessDatabase } from "@/lib/device/schema";
import type { RepeatPlan, SlimMedicine, UsualResponse } from "@/lib/orders/fast-types";

const BIZ = "123e4567-e89b-42d3-a456-426614174000";
const T0 = Date.parse("2026-11-21T10:00:00.000Z");

function med(i: number, extra: Record<string, unknown> = {}): SlimMedicine {
  return {
    id: `m${String(i).padStart(5, "0")}`,
    name: `Medicine ${i}`,
    unit: "strip",
    brand: null,
    generic_name: null,
    strength: "500 mg",
    dosage_form: "tablet",
    manufacturer: "Acme",
    pack_size: "10",
    sku: null,
    selling_price: "12.00",
    ...extra,
  } as SlimMedicine;
}

interface Fake {
  transport: CacheTransport;
  calls: string[];
  failPaths: Set<string>;
  medicines: SlimMedicine[];
}

function fake(count: number, options: { extraKeys?: boolean; storeIds?: string[]; sources?: Record<string, boolean> } = {}): Fake {
  const medicines = Array.from({ length: count }, (_, i) => med(i, options.extraKeys ? { purchase_price: "5.00", mrp: "20.00", cost: "4" } : {}));
  const storeIds = options.storeIds ?? ["s1", "s2"];
  const calls: string[] = [];
  const failPaths = new Set<string>();
  const transport: CacheTransport = {
    async get<T>(path: string): Promise<T> {
      calls.push(path);
      for (const bad of failPaths) if (path.startsWith(bad)) throw new Error(`network: ${bad}`);
      const url = new URL(path, "http://x");
      if (url.pathname === "/api/orders/medicines") {
        const limit = Number(url.searchParams.get("limit"));
        const start = Number(url.searchParams.get("cursor") ?? 0);
        const items = medicines.slice(start, start + limit);
        return { items, next_cursor: start + limit < medicines.length ? String(start + limit) : null } as T;
      }
      if (url.pathname === "/api/stores") {
        return {
          items: storeIds.map((id) => ({ id, name: `Store ${id}`, contact_person: null, phone: null, address: null, notes: null, is_active: true, version: 1, created_at: "", updated_at: "" })),
          next_cursor: null,
        } as T;
      }
      if (url.pathname === "/api/orders") {
        return { items: storeIds.map((id) => ({ store: { id, name: id } })), next_cursor: null } as T;
      }
      if (url.pathname === "/api/orders/usual") {
        const storeId = url.searchParams.get("store_id")!;
        const hasSource = options.sources?.[storeId] ?? true;
        const usual: UsualResponse = {
          usual: [],
          source: hasSource ? { order_id: `o-${storeId}`, order_number: 1, confirmed_at: "2026-11-01T00:00:00Z", line_count: 1 } : null,
        };
        return usual as T;
      }
      if (url.pathname === "/api/orders/repeat") {
        const plan: RepeatPlan = { lines: [], skipped: [] };
        return plan as T;
      }
      throw new Error(`unexpected path ${path}`);
    },
  };
  return { transport, calls, failPaths, medicines };
}

async function openDb(storage = new MemoryDeviceStorage()): Promise<{ storage: MemoryDeviceStorage; db: BusinessDatabase }> {
  const r = await storage.openBusiness(BIZ);
  if (!r.ok) throw new Error("open failed");
  return { storage, db: r.db };
}

const env = (now = T0) => ({ nowMs: () => now });

describe("device copy refresh", () => {
  it("stores every medicine and store, sets the times, and prepares the recent stores", async () => {
    const { db } = await openDb();
    const f = fake(2_000);
    const result = await refreshDeviceCopy(db, f.transport, env());
    expect(result).toMatchObject({ status: "ok", medicines: 2_000, stores: 2, extras: 2, truncated: false });
    expect((await db.getAll("medicines")).length).toBe(2_000);
    expect((await db.getAll("stores")).map((s) => s.id).sort()).toEqual(["s1", "s2"]);
    expect((await db.get("storeExtras", "s1"))?.repeatPlan).toEqual({ lines: [], skipped: [] });
    expect((await db.get("meta", "medicinesUpdatedAt"))?.value).toBe(new Date(T0).toISOString());
    expect((await db.get("meta", "storesUpdatedAt"))?.value).toBe(new Date(T0).toISOString());
  });

  it("holds 5,000 medicines", async () => {
    const { db } = await openDb();
    const result = await refreshDeviceCopy(db, fake(5_000).transport, env());
    expect(result).toMatchObject({ status: "ok", medicines: 5_000 });
  });

  it("keeps the previous list when a later page fails, and sets no time", async () => {
    const { db } = await openDb();
    await refreshDeviceCopy(db, fake(1_000).transport, env());
    const f = fake(3_000);
    f.failPaths.add("/api/orders/medicines?limit=900&cursor=1800");
    const result = await refreshDeviceCopy(db, f.transport, env(T0 + 10 * 60_000));
    expect(result.status).toBe("failed");
    expect((await db.getAll("medicines")).length).toBe(1_000);
    expect((await db.get("meta", "medicinesUpdatedAt"))?.value).toBe(new Date(T0).toISOString());
  });

  it("drops every key outside the whitelist before storing (no purchase price, MRP or cost)", async () => {
    const { db } = await openDb();
    await refreshDeviceCopy(db, fake(3, { extraKeys: true }).transport, env());
    const stored = await db.getAll("medicines");
    expect(stored.length).toBe(3);
    for (const row of stored) {
      expect(Object.keys(row).sort()).toEqual(["brand", "dosage_form", "generic_name", "id", "manufacturer", "name", "pack_size", "selling_price", "sku", "strength", "unit"]);
    }
    expect(JSON.stringify(stored)).not.toMatch(/purchase|mrp|cost/i);
  });

  it("skips an automatic refresh within 5 minutes, runs after that, and lets the button force it", async () => {
    const { db } = await openDb();
    const f = fake(10);
    await refreshDeviceCopy(db, f.transport, env());
    const callsAfterFirst = f.calls.length;
    expect(await refreshDeviceCopy(db, f.transport, env(T0 + FRESH_MS - 1))).toEqual({ status: "skipped", reason: "fresh" });
    expect(f.calls.length).toBe(callsAfterFirst);
    expect((await refreshDeviceCopy(db, f.transport, env(T0 + FRESH_MS + 1))).status).toBe("ok");
    const before = f.calls.length;
    expect((await refreshDeviceCopy(db, f.transport, env(T0 + FRESH_MS + 2), { force: true })).status).toBe("ok");
    expect(f.calls.length).toBeGreaterThan(before);
  });

  it("skips with storage_low when the quota is nearly full, even for the button", async () => {
    const { db } = await openDb();
    const f = fake(10);
    const low = { nowMs: () => T0, storageEstimate: async () => ({ usage: 91, quota: 100 }) };
    expect(await refreshDeviceCopy(db, f.transport, low)).toEqual({ status: "skipped", reason: "storage_low" });
    expect(await refreshDeviceCopy(db, f.transport, low, { force: true })).toEqual({ status: "skipped", reason: "storage_low" });
    expect(f.calls).toEqual([]);
    const fine = { nowMs: () => T0, storageEstimate: async () => ({ usage: 50, quota: 100 }) };
    expect((await refreshDeviceCopy(db, f.transport, fine)).status).toBe("ok");
  });

  it("builds the recent-store list from the stores opened here and the 20 latest orders, active stores only, at most 10", async () => {
    const { db } = await openDb();
    const ids = Array.from({ length: 15 }, (_, i) => `s${i}`);
    const f = fake(3, { storeIds: ids });
    await noteStoreOpened(db, "s14");
    await noteStoreOpened(db, "not-active");
    await refreshDeviceCopy(db, f.transport, env());
    expect(f.calls.some((c) => c.startsWith("/api/orders?limit=20"))).toBe(true);
    const extras = (await db.getAll("storeExtras")).map((e) => e.storeId);
    expect(extras.length).toBe(10);
    expect(extras).toContain("s14");
    expect(extras).not.toContain("not-active");
  });

  it("stores no repeat plan for a store without a confirmed order", async () => {
    const { db } = await openDb();
    await refreshDeviceCopy(db, fake(3, { sources: { s1: false } }).transport, env());
    expect((await db.get("storeExtras", "s1"))?.repeatPlan).toBeNull();
  });

  it("keeps the refresh when one store's extras fail", async () => {
    const { db } = await openDb();
    const f = fake(3);
    f.failPaths.add("/api/orders/usual?store_id=s1");
    const result = await refreshDeviceCopy(db, f.transport, env());
    expect(result).toMatchObject({ status: "ok", extras: 1 });
    expect(await db.get("storeExtras", "s1")).toBeUndefined();
  });

  it("keeps stores made on this device that are still pending", async () => {
    const { db } = await openDb();
    await db.put("stores", { id: "local-1", name: "Made offline", contact_person: null, phone: null, address: null, is_active: true, pending: true });
    await refreshDeviceCopy(db, fake(3).transport, env());
    expect((await db.getAll("stores")).map((s) => s.id).sort()).toEqual(["local-1", "s1", "s2"]);
  });

  it("reports the age of the copy and whether it is older than a day", async () => {
    const { db } = await openDb();
    expect((await readCacheAge(db, T0)).empty).toBe(true);
    await refreshDeviceCopy(db, fake(3).transport, env());
    const fresh = await readCacheAge(db, T0 + 60_000);
    expect(fresh).toMatchObject({ empty: false, stale: false });
    expect((await readCacheAge(db, T0 + STALE_MS + 1)).stale).toBe(true);
  });
});

describe("Module 012: the store prices kept on the phone", () => {
  function withRates(f: Fake, rates: Array<Record<string, unknown>>): CacheTransport {
    return {
      async get<T>(path: string): Promise<T> {
        if (path.startsWith("/api/orders/rates")) return { items: rates, next_cursor: null } as T;
        return f.transport.get<T>(path);
      },
    };
  }
  const rate = { store_id: "s1", product_id: "m00000", rate: "220.00", version: 2, catalog_price_at_set: "200.00", purchase_price: "90.00" };

  it("stores only the selling rate fields, answers the store's list offline, and drops a removed rate", async () => {
    const { db } = await openDb();
    const f = fake(3);
    await refreshDeviceCopy(db, withRates(f, [rate, { ...rate, store_id: "s2", rate: "230.00" }]), env());
    expect(Object.keys((await db.get("storeRates", "s1:m00000"))!).sort()).toEqual(["catalogPriceAtSet", "key", "productId", "rate", "storeId", "version"]);

    const answer = await answerLocal(db, "GET", "/api/stores/s1/rates");
    expect(answer).toMatchObject({ status: 200, body: { items: [{ product_id: "m00000", rate: "220.00", version: 2, catalog_price: "12.00", product: { unit: "strip" } }] } });

    await refreshDeviceCopy(db, withRates(f, []), env(), { force: true });
    expect(await db.getAll("storeRates")).toEqual([]);
  });

  it("says the list is not on the phone when it was never loaded, and keeps the older copy when a refresh of it fails", async () => {
    const { db } = await openDb();
    expect((await answerLocal(db, "GET", "/api/stores/s1/rates"))!.status).toBe(503);
    const f = fake(3);
    await refreshDeviceCopy(db, withRates(f, [rate]), env());
    const result = await refreshDeviceCopy(db, f.transport, env(), { force: true }); // the rate route fails
    expect(result.status).toBe("ok");
    expect(await db.getAll("storeRates")).toHaveLength(1);
  });
});

describe("a phone database closed while a refresh is running", () => {
  it("ends as a failed refresh and never as an unhandled error", async () => {
    const { db } = await openDb();
    // As in the browser: the first read is answered, then the screen stops the runtime and the connection is closing.
    let reads = 0;
    const closing = new Proxy(db, {
      get(target, key) {
        if (key === "get") {
          return async (...args: Parameters<BusinessDatabase["get"]>) => {
            reads += 1;
            if (reads > 1) throw new DOMException("The database connection is closing.", "InvalidStateError");
            return args[0] === "meta" ? { key: args[1], value: new Date(T0 - FRESH_MS * 2).toISOString() } : undefined;
          };
        }
        const value = Reflect.get(target, key) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const { transport, calls } = fake(1);
    await expect(refreshDeviceCopy(closing, transport, { nowMs: () => T0 })).resolves.toEqual({ status: "failed", message: "The database connection is closing." });
    expect(calls).toEqual([]);
  });
});
