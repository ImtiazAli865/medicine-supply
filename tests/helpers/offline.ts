import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { TestTenant } from "./supabase-test";
import { serviceClient } from "./supabase-test";

// Helpers for the offline browser tests (Module 009). They run against the production build and the TEST Supabase project.
// Going offline uses Playwright's network emulation; the spike (T002, quickstart section 6) records whether that also cuts
// the requests the service worker makes, and `goOffline` follows that outcome.

/** The browser has no network (requests of the page and of the service worker fail). */
export async function goOffline(context: BrowserContext): Promise<void> {
  await context.setOffline(true);
}

export async function goOnline(context: BrowserContext): Promise<void> {
  await context.setOffline(false);
}

/** Runs in the page: one record of the device database of the signed-in business (undefined when there is none). */
export async function idbGet(page: Page, store: string, key: string): Promise<unknown> {
  return page.evaluate(
    async ({ store, key }) => {
      const dbs = (await indexedDB.databases?.()) ?? [];
      const name = dbs.find((d) => d.name?.startsWith("medsupply-") && d.name !== "medsupply-registry")?.name;
      if (!name) return undefined;
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        if (!db.objectStoreNames.contains(store)) return undefined;
        return await new Promise<unknown>((resolve) => {
          const req = db.transaction(store, "readonly").objectStore(store).get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        });
      } finally {
        db.close();
      }
    },
    { store, key },
  );
}

/** Runs in the page: how many records a store of the device database holds. */
export async function idbCount(page: Page, store: string): Promise<number> {
  return page.evaluate(async (store) => {
    const dbs = (await indexedDB.databases?.()) ?? [];
    const name = dbs.find((d) => d.name?.startsWith("medsupply-") && d.name !== "medsupply-registry")?.name;
    if (!name) return 0;
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      if (!db.objectStoreNames.contains(store)) return 0;
      return await new Promise<number>((resolve) => {
        const req = db.transaction(store, "readonly").objectStore(store).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(0);
      });
    } finally {
      db.close();
    }
  }, store);
}

/**
 * Waits until the app is ready to work offline: the service worker controls the page, the offline shell and the app files
 * are kept, the lists were refreshed once, and the usual medicines and last order of the given stores were saved too.
 */
export async function waitDeviceReady(page: Page, options: { storeExtras?: string[] } = {}): Promise<void> {
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker?.controller), { timeout: 30_000, message: "the service worker controls the page" }).toBe(true);
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).some((n) => n.startsWith("medsupply-shell-"))), { timeout: 30_000, message: "the app files are kept" })
    .toBe(true);
  await expect.poll(async () => (await idbGet(page, "meta", "medicinesUpdatedAt")) !== undefined, { timeout: 60_000, message: "the medicine list is saved" }).toBe(true);
  await expect.poll(async () => (await idbGet(page, "meta", "storesUpdatedAt")) !== undefined, { timeout: 60_000, message: "the store list is saved" }).toBe(true);
  for (const storeId of options.storeExtras ?? []) {
    await expect.poll(async () => (await idbGet(page, "storeExtras", storeId)) !== undefined, { timeout: 60_000, message: `the usual medicines of store ${storeId} are saved` }).toBe(true);
  }
}

/** Every draft record of the device database of the signed-in business, read straight from IndexedDB. */
export async function readJournal(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(async () => {
    const dbs = (await indexedDB.databases?.()) ?? [];
    const name = dbs.find((d) => d.name?.startsWith("medsupply-") && d.name !== "medsupply-registry")?.name;
    if (!name) return [];
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      return await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const req = db.transaction("drafts", "readonly").objectStore("drafts").getAll();
        req.onsuccess = () => resolve(req.result as Array<Record<string, unknown>>);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  });
}

interface ServerOrderRow {
  id: string;
  status: string;
  version: number;
  store_id: string;
}

/** The orders the server holds for this business (read with the service role, so the test sees the truth). */
export async function ordersOnServer(tenant: TestTenant): Promise<ServerOrderRow[]> {
  const { data, error } = await serviceClient().from("orders").select("id,status,version,store_id").eq("business_id", tenant.businessId!).order("created_at", { ascending: true });
  if (error) throw new Error(`orders on server: ${error.message}`);
  return (data ?? []) as ServerOrderRow[];
}

export async function countOrders(tenant: TestTenant): Promise<number> {
  return (await ordersOnServer(tenant)).length;
}

/** The lines of one order on the server (non-removed), in order, for exact comparisons. */
export async function linesOnServer(orderId: string): Promise<Array<{ name: string; quantity: number; unit: string; product_id: string | null }>> {
  const { data, error } = await serviceClient().from("order_lines").select("name,quantity,unit,product_id,position").eq("order_id", orderId).is("removed_at", null).order("position", { ascending: true });
  if (error) throw new Error(`lines on server: ${error.message}`);
  return (data ?? []) as Array<{ name: string; quantity: number; unit: string; product_id: string | null }>;
}

/** Makes the page's IndexedDB fail to open (a private window or blocked storage), before any script of the app runs. */
export async function blockDeviceStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fail = () => {
      throw new DOMException("The storage is blocked.", "SecurityError");
    };
    Object.defineProperty(window, "indexedDB", { configurable: true, get: () => ({ open: fail, deleteDatabase: fail, databases: async () => [] }) });
  });
}
