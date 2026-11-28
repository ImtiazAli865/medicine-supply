// Starts the device side of the app for one signed-in business (Module 009): storage, identity, connectivity, the sync
// centre, the cache refresh and the local answers. Browser-only glue: everything with logic lives in the pure files it
// calls. One runtime per page; `stop()` releases the lock and the timers.

import { fetchJson, setConnectivityReporter, setLocalAnswerHook } from "@/lib/api/client";
import { newId } from "@/lib/ids";
import { readCacheAge, refreshDeviceCopy, refreshRates, type CacheAge, type RefreshOutcome } from "./cache";
import { createConnectivity, type Connectivity } from "./connectivity";
import { createIndexedDbStorage } from "./db";
import { rememberIdentity, resolveIdentity, type Identity } from "./identity";
import { answerLocal } from "./local-api";
import { createLeaderElection } from "./locks";
import { RATES_CHANGED_EVENT, saveOrderTransport } from "@/lib/orders/save-transport";
import { saveStoreTransport } from "./store-transport";
import { sendPaymentTransport } from "./payment-transport";
import type { BusinessDatabase, DeviceStorage } from "./schema";
import { SyncCenter } from "./sync-center";

export type DeviceMode = "ready" | "unavailable" | "newer_schema" | "needs_sign_in";

export interface DeviceRuntime {
  mode: DeviceMode;
  message: string | null;
  storage: DeviceStorage;
  db: BusinessDatabase | null;
  connectivity: Connectivity;
  center: SyncCenter | null;
  identity: Identity;
  /** Refreshes the device copy now (the Refresh button forces it). */
  refresh(force: boolean): Promise<RefreshOutcome>;
  readCacheAge(): Promise<CacheAge | null>;
  /** Deletes this business's data on this phone (its database and the registry entry). The caller warned the supplier and offered the backup first. */
  clearData(): Promise<void>;
  stop(): void;
}

export interface StartArgs {
  /** The server-verified user and business (online start) or null (offline shell: the cookie decides). */
  server: { userId: string; businessId: string; businessName: string } | null;
  /** Called after every refresh of the device copy (automatic or by the button) with its outcome. */
  onRefreshed?: (outcome: RefreshOutcome) => void;
}

const REFRESH_EVERY_MS = 10 * 60_000;

async function ping(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const response = await fetch("/api/ping", { cache: "no-store", signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

export async function startDeviceRuntime(args: StartArgs): Promise<DeviceRuntime> {
  const storage = createIndexedDbStorage();
  const connectivity = createConnectivity({ ping }, typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online");
  setConnectivityReporter(connectivity);
  const cookie = typeof document === "undefined" ? "" : document.cookie;

  // A browser that cannot keep data (a private window, blocked storage) cannot even read the registry: that is "unavailable",
  // not "sign in again". Online use then works exactly as before.
  let identity: Identity;
  let storageBroken = false;
  try {
    identity = args.server ? await rememberIdentity(storage, cookie, args.server) : await resolveIdentity(storage, cookie);
  } catch {
    storageBroken = true;
    identity = args.server ? { status: "ok", ...args.server } : { status: "needs_sign_in", reason: "no_registry" };
  }

  const stopped: DeviceRuntime = {
    mode: identity.status === "ok" ? "unavailable" : "needs_sign_in",
    message: null,
    storage,
    db: null,
    connectivity,
    center: null,
    identity,
    refresh: async () => ({ status: "failed", message: "The device copy is not available." }),
    readCacheAge: async () => null,
    clearData: async () => undefined,
    stop: () => {
      connectivity.stop();
      setConnectivityReporter(null);
    },
  };
  if (storageBroken && !args.server) {
    return { ...stopped, mode: "unavailable", message: "This browser cannot keep offline data here (a private window, blocked or full storage). The app works only while online." };
  }
  if (identity.status !== "ok") return stopped;

  const opened = await storage.openBusiness(identity.businessId);
  if (!opened.ok) return { ...stopped, mode: opened.reason, message: opened.message };
  const db = opened.db;

  setLocalAnswerHook((method, url) => answerLocal(db, method, url));

  const election = createLeaderElection(`medsupply-sync-${identity.businessId}`, typeof navigator !== "undefined" ? navigator.locks : undefined);
  const center = new SyncCenter({
    db,
    connectivity,
    election,
    transport: saveOrderTransport,
    storeTransport: saveStoreTransport,
    paymentTransport: sendPaymentTransport,
    scheduler: { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    newId,
    nowText: () => new Date().toISOString(),
  });
  await center.start();

  const refresh = async (force: boolean): Promise<RefreshOutcome> => {
    const outcome = await refreshDeviceCopy(
      db,
      { get: async <T,>(path: string) => (await fetchJson<T>(path)).data },
      {
        nowMs: () => Date.now(),
        storageEstimate: typeof navigator !== "undefined" && navigator.storage?.estimate ? () => navigator.storage.estimate() : undefined,
      },
      { force },
    );
    args.onRefreshed?.(outcome);
    return outcome;
  };

  // A rate saved on this phone reaches its copy at once, so the next order without the internet shows it.
  const onRatesChanged = () => void refreshRates(db, { get: async <T,>(path: string) => (await fetchJson<T>(path)).data }, new Date().toISOString());
  window.addEventListener(RATES_CHANGED_EVENT, onRatesChanged);

  const onOnline = () => connectivity.browserOnline();
  const onOffline = () => connectivity.browserOffline();
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  const offConnectivity = connectivity.subscribe((state) => {
    if (state === "online") void refresh(false);
  });
  if (args.server) {
    // Only an online start (the server verified the session) refreshes; the offline shell never calls the network for lists.
    void refresh(false);
    refreshTimer = setInterval(() => void refresh(false), REFRESH_EVERY_MS);
  }

  return {
    mode: "ready",
    message: null,
    storage,
    db,
    connectivity,
    center,
    identity,
    refresh,
    // A stopped runtime has closed its database; a late question then has no answer instead of an error.
    readCacheAge: () => readCacheAge(db, Date.now()).catch(() => null),
    clearData: async () => {
      // Stop sending first, then delete only THIS business's database (never another business's) and its registry entry.
      center.stop();
      db.close();
      await storage.deleteBusiness(identity.businessId);
      await storage.removeRegistryEntry(identity.userId);
    },
    stop: () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener(RATES_CHANGED_EVENT, onRatesChanged);
      window.removeEventListener("offline", onOffline);
      offConnectivity();
      if (refreshTimer !== null) clearInterval(refreshTimer);
      center.stop();
      election.stop();
      setLocalAnswerHook(null);
      setConnectivityReporter(null);
      connectivity.stop();
      db.close();
    },
  };
}
