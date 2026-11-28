// The device copy of the lists the order screens need (Module 009, plan D8): the active medicines (slim shape), the active
// stores, and for the stores used recently their usual-medicines and last-order answers. Everything is fetched first and
// written in one atomic step per list, so an interrupted refresh never leaves half a list. Only whitelisted medicine keys
// are stored: a purchase price, MRP or cost could never end up on the device even if a route returned one by mistake.

import { PAGE_SIZE } from "@/lib/orders/fast-list";
import { SLIM_MEDICINE_KEYS, type MedicinePage, type RepeatPlan, type SlimMedicine, type UsualResponse } from "@/lib/orders/fast-types";
import type { OrderPage } from "@/lib/orders/types";
import type { DeviceRatePage } from "@/lib/rates/types";
import type { StorePage } from "@/lib/stores/types";
import type { BatchOp, BusinessDatabase, StoredMedicine, StoredRate, StoredStore } from "./schema";

export const FRESH_MS = 5 * 60_000;
export const STALE_MS = 24 * 60 * 60_000;
export const RECENT_STORE_COUNT = 10;
const RECENT_ORDER_LIMIT = 20;
const STORAGE_LOW_RATIO = 0.9;
/** A safety stop only (Module 008 holds at most 6,000 in memory, but the device copy keeps the whole catalog and searches it locally). */
const DEVICE_MEDICINE_LIMIT = 50_000;

export interface CacheTransport {
  /** A GET of this app's API. Throws on any failure. */
  get<T>(path: string): Promise<T>;
}

export interface CacheEnv {
  nowMs(): number;
  /** `navigator.storage.estimate()` when the browser has it. */
  storageEstimate?(): Promise<{ usage?: number; quota?: number } | undefined>;
}

export type RefreshOutcome =
  | { status: "ok"; medicines: number; stores: number; extras: number; truncated: boolean }
  | { status: "skipped"; reason: "fresh" | "storage_low" }
  | { status: "failed"; message: string };

function isSlim(row: unknown): row is Record<string, unknown> {
  if (typeof row !== "object" || row === null) return false;
  const r = row as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.name === "string" && typeof r.unit === "string";
}

/** Keeps only the whitelisted keys, so nothing else a route might return is stored. */
export function pickSlim(row: Record<string, unknown>): StoredMedicine {
  const out: Record<string, unknown> = {};
  for (const key of SLIM_MEDICINE_KEYS) out[key] = row[key] ?? null;
  return out as unknown as SlimMedicine;
}

async function loadMedicines(transport: CacheTransport): Promise<{ rows: StoredMedicine[]; truncated: boolean }> {
  const rows: StoredMedicine[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) params.set("cursor", cursor);
    const page: MedicinePage = await transport.get<MedicinePage>(`/api/orders/medicines?${params}`);
    for (const row of page.items) if (isSlim(row)) rows.push(pickSlim(row));
    cursor = page.next_cursor;
    if (rows.length >= DEVICE_MEDICINE_LIMIT) return { rows: rows.slice(0, DEVICE_MEDICINE_LIMIT), truncated: cursor !== null || rows.length > DEVICE_MEDICINE_LIMIT };
  } while (cursor);
  return { rows, truncated: false };
}

/** Every store rate (selling prices only), kept with exactly these fields. */
async function loadRates(transport: CacheTransport): Promise<StoredRate[]> {
  const rows: StoredRate[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ limit: "900" });
    if (cursor) params.set("cursor", cursor);
    const page: DeviceRatePage = await transport.get<DeviceRatePage>(`/api/orders/rates?${params}`);
    for (const r of page.items) {
      rows.push({ key: `${r.store_id}:${r.product_id}`, storeId: r.store_id, productId: r.product_id, rate: r.rate, version: r.version, catalogPriceAtSet: r.catalog_price_at_set ?? null });
    }
    cursor = page.next_cursor;
  } while (cursor);
  return rows;
}

/** Replaces the rate copy in one atomic step. A failure keeps the older copy; the rest of the refresh still counts. */
export async function refreshRates(db: BusinessDatabase, transport: CacheTransport, stamp: string): Promise<void> {
  try {
    const rows = await loadRates(transport);
    const keep = new Set(rows.map((r) => r.key));
    const removals: BatchOp[] = (await db.getAll("storeRates")).filter((r) => !keep.has(r.key)).map((r) => ({ op: "remove", store: "storeRates", key: r.key }));
    await db.batch([...removals, ...rows.map((value): BatchOp => ({ op: "put", store: "storeRates", value })), { op: "put", store: "meta", value: { key: "ratesUpdatedAt", value: stamp } }]);
  } catch {
    // The older copy of the rates stays; a price that moved is still caught at confirm.
  }
}

async function loadStores(transport: CacheTransport): Promise<StoredStore[]> {
  const rows: StoredStore[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ status: "active", limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const page: StorePage = await transport.get<StorePage>(`/api/stores?${params}`);
    for (const s of page.items) {
      rows.push({ id: s.id, name: s.name, contact_person: s.contact_person ?? null, phone: s.phone ?? null, address: s.address ?? null, is_active: s.is_active, pending: false });
    }
    cursor = page.next_cursor;
  } while (cursor);
  return rows;
}

/** The ids of the stores to prepare for offline use: opened on this device first, then the stores of the latest orders. */
async function recentStoreIds(db: BusinessDatabase, transport: CacheTransport, activeIds: Set<string>): Promise<string[]> {
  const opened = ((await db.get("meta", "recentStores"))?.value as string[] | undefined) ?? [];
  let fromOrders: string[] = [];
  try {
    const page = await transport.get<OrderPage>(`/api/orders?limit=${RECENT_ORDER_LIMIT}`);
    fromOrders = page.items.map((o) => o.store.id);
  } catch {
    // The latest orders are only a hint: without them the stores opened here still get prepared.
  }
  const ids: string[] = [];
  for (const id of [...opened, ...fromOrders]) {
    if (activeIds.has(id) && !ids.includes(id)) ids.push(id);
    if (ids.length >= RECENT_STORE_COUNT) break;
  }
  return ids;
}

/** Remembers that this store's order screen was opened here (it will be prepared for offline use). */
export async function noteStoreOpened(db: BusinessDatabase, storeId: string): Promise<void> {
  const current = ((await db.get("meta", "recentStores"))?.value as string[] | undefined) ?? [];
  const next = [storeId, ...current.filter((id) => id !== storeId)].slice(0, RECENT_STORE_COUNT * 2);
  await db.put("meta", { key: "recentStores", value: next });
}

/**
 * Refreshes the device copy. An automatic refresh is skipped when the last complete one is younger than 5 minutes and when
 * the browser's storage estimate is above 90% of the quota; `force` (the Refresh button) skips only the first rule.
 */
export async function refreshDeviceCopy(
  db: BusinessDatabase,
  transport: CacheTransport,
  env: CacheEnv,
  options: { force?: boolean } = {},
): Promise<RefreshOutcome> {
  const now = env.nowMs();
  // Every read of the phone database stays inside a try: the connection can be closing, and this must never reject.
  if (!options.force) {
    try {
      const updated = (await db.get("meta", "medicinesUpdatedAt"))?.value as string | undefined;
      const storesUpdated = (await db.get("meta", "storesUpdatedAt"))?.value as string | undefined;
      if (updated && storesUpdated) {
        const age = now - Date.parse(updated);
        if (Number.isFinite(age) && age >= 0 && age < FRESH_MS) return { status: "skipped", reason: "fresh" };
      }
    } catch (error) {
      return failed(error);
    }
  }
  try {
    const estimate = await env.storageEstimate?.();
    if (estimate?.quota && estimate.usage !== undefined && estimate.usage / estimate.quota > STORAGE_LOW_RATIO) {
      return { status: "skipped", reason: "storage_low" };
    }
  } catch {
    // No estimate available: carry on.
  }

  try {
    const medicines = await loadMedicines(transport);
    const stores = await loadStores(transport);
    const activeIds = new Set(stores.map((s) => s.id));
    const recent = await recentStoreIds(db, transport, activeIds);

    const extras: Array<{ storeId: string; usual: UsualResponse; repeatPlan: RepeatPlan | null }> = [];
    for (const storeId of recent) {
      try {
        const usual = await transport.get<UsualResponse>(`/api/orders/usual?store_id=${encodeURIComponent(storeId)}`);
        const repeatPlan = usual.source
          ? await transport.get<RepeatPlan>(`/api/orders/repeat?store_id=${encodeURIComponent(storeId)}&order_id=${encodeURIComponent(usual.source.order_id)}`)
          : null;
        extras.push({ storeId, usual, repeatPlan });
      } catch {
        // One store failing keeps that store's older copy; the refresh as a whole still counts.
      }
    }

    const stamp = new Date(now).toISOString();
    await refreshRates(db, transport, stamp);
    await db.replaceMedicines(medicines.rows, stamp);
    await db.replaceStores(stores, stamp);
    for (const e of extras) await db.put("storeExtras", { storeId: e.storeId, usual: e.usual, repeatPlan: e.repeatPlan, updatedAt: stamp });
    return { status: "ok", medicines: medicines.rows.length, stores: stores.length, extras: extras.length, truncated: medicines.truncated };
  } catch (error) {
    return failed(error);
  }
}

function failed(error: unknown): RefreshOutcome {
  return { status: "failed", message: error instanceof Error && error.message ? error.message : "The lists could not be refreshed." };
}

export interface CacheAge {
  medicinesUpdatedAt: string | null;
  storesUpdatedAt: string | null;
  /** True when the older of the two is more than a day old. */
  stale: boolean;
  /** True when no refresh ever completed on this device. */
  empty: boolean;
}

export async function readCacheAge(db: BusinessDatabase, nowMs: number): Promise<CacheAge> {
  const medicinesUpdatedAt = ((await db.get("meta", "medicinesUpdatedAt"))?.value as string | undefined) ?? null;
  const storesUpdatedAt = ((await db.get("meta", "storesUpdatedAt"))?.value as string | undefined) ?? null;
  const stamps = [medicinesUpdatedAt, storesUpdatedAt].filter((v): v is string => v !== null).map((v) => Date.parse(v));
  const oldest = stamps.length === 0 ? null : Math.min(...stamps);
  return {
    medicinesUpdatedAt,
    storesUpdatedAt,
    stale: oldest !== null && nowMs - oldest > STALE_MS,
    empty: medicinesUpdatedAt === null && storesUpdatedAt === null,
  };
}
