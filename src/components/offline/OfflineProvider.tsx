"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { CacheAge, RefreshOutcome } from "@/lib/device/cache";
import type { ServerIdentity } from "@/lib/device/identity";
import { workerStatus, type WorkerStatus } from "@/lib/device/worker-status";
import { startDeviceRuntime, type DeviceMode, type DeviceRuntime } from "@/lib/device/runtime";
import type { PaymentInput } from "@/lib/accounts/payment-input";
import type { RecordPaymentResult, SyncCenter, SyncStatus } from "@/lib/device/sync-center";

// Starts the device side of the app once per page for the signed-in business and shares its state (Module 009). Nothing here
// changes what an online screen shows when there is nothing to report: without a device database (private window, blocked
// storage) the app keeps working online exactly as before and says so where it matters.

export interface OfflineContextValue {
  /** "starting" until the device storage has been opened (or found unavailable). */
  mode: "starting" | DeviceMode;
  message: string | null;
  online: boolean;
  status: SyncStatus | null;
  cacheAge: CacheAge | null;
  /** Store names kept on this phone, by id (for orders that are not yet on the server). */
  storeNames: Record<string, string>;
  /** The last refresh was skipped because the phone's storage is nearly full. */
  storageLow: boolean;
  refreshing: boolean;
  runtime: DeviceRuntime | null;
  center: SyncCenter | null;
  refresh(): Promise<RefreshOutcome | null>;
  /** Whether the offline worker can run on this address; anything but "ok" is shown to the person (Module 011). */
  worker: WorkerStatus;
  /** Records a cash payment on this phone (kept until the server confirms it). Refused with a reason when the phone cannot keep it. */
  recordPayment(args: { storeId: string; input: PaymentInput; paymentId?: string }): Promise<RecordPaymentResult>;
  /** Removes a waiting payment after the supplier confirmed it. False when the rules do not allow it. */
  removePayment(paymentId: string): Promise<boolean>;
}

const NO_STORAGE_MESSAGE = "This phone cannot keep the payment here, so nothing was recorded.";

const NOOP_VALUE: OfflineContextValue = {
  mode: "starting",
  message: null,
  online: true,
  status: null,
  cacheAge: null,
  storeNames: {},
  storageLow: false,
  refreshing: false,
  runtime: null,
  center: null,
  refresh: async () => null,
  worker: "ok",
  recordPayment: async () => ({ ok: false, reason: "storage", message: NO_STORAGE_MESSAGE }),
  removePayment: async () => false,
};

// The state is shared through a small external store, and the React context carries only the (never changing) store. A context
// whose value changes would force every part of the page that React has not yet hydrated (the page content waiting inside its
// loading boundary) to be rendered again in the browser while the server is still streaming it, which briefly leaves two copies
// of the page content in the document. A store only wakes the components that read it.
interface OfflineStore {
  get(): OfflineContextValue;
  set(value: OfflineContextValue): void;
  subscribe(listener: () => void): () => void;
}

function createOfflineStore(): OfflineStore {
  let current = NOOP_VALUE;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(value) {
      if (value === current) return;
      current = value;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const OfflineContext = createContext<OfflineStore>(createOfflineStore());

export function useOffline(): OfflineContextValue {
  const store = useContext(OfflineContext);
  return useSyncExternalStore(store.subscribe, store.get, () => NOOP_VALUE);
}

/** Registers the service worker; resolves true when it is registered (or not needed) and false when the browser refused it. */
function registerWorker(): Promise<boolean> {
  if (process.env.NODE_ENV !== "production" || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return Promise.resolve(true);
  const register = () =>
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(
      () => true,
      (error: unknown) => {
        // Only the offline reload is lost; the app itself keeps working, and the person is told.
        console.info("The offline service worker could not be registered.", error instanceof Error ? error.message : "");
        return false;
      },
    );
  if (document.readyState === "complete") return register();
  return new Promise<boolean>((resolve) => window.addEventListener("load", () => void register().then(resolve), { once: true }));
}

const CACHE_AGE_EVERY_MS = 30_000;

interface AddressFacts {
  isSecureContext: boolean;
  hasServiceWorker: boolean;
}

let addressFacts: AddressFacts | null = null;

/** What the browser says about the address of this page; read once (it cannot change while the page is open). */
function readAddressFacts(): AddressFacts {
  addressFacts ??= { isSecureContext: window.isSecureContext, hasServiceWorker: "serviceWorker" in navigator };
  return addressFacts;
}

const subscribeNever = () => () => undefined;

/** `server` is the verified user and business of an online page; null in the offline shell (the cookie decides). */
export function OfflineProvider({ server, children }: { server: ServerIdentity | null; children: ReactNode }) {
  const [runtime, setRuntime] = useState<DeviceRuntime | null>(null);
  const [mode, setMode] = useState<OfflineContextValue["mode"]>("starting");
  const [message, setMessage] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [cacheAge, setCacheAge] = useState<CacheAge | null>(null);
  const [storeNames, setStoreNames] = useState<Record<string, string>>({});
  const [storageLow, setStorageLow] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [registerFailed, setRegisterFailed] = useState(false);

  const runtimeRef = useRef<DeviceRuntime | null>(null);
  const userId = server?.userId ?? null;
  const businessId = server?.businessId ?? null;
  const businessName = server?.businessName ?? null;

  useEffect(() => {
    let cancelled = false;
    let started: DeviceRuntime | null = null;
    const offs: Array<() => void> = [];
    let timer: ReturnType<typeof setInterval> | null = null;

    const identity = userId && businessId && businessName ? { userId, businessId, businessName } : null;
    startDeviceRuntime({
      server: identity,
      onRefreshed: (outcome) => {
        if (cancelled) return;
        setStorageLow(outcome.status === "skipped" && outcome.reason === "storage_low");
        if (outcome.status === "ok")
          void runtimeRef.current?.readCacheAge().then((age) => !cancelled && setCacheAge(age));
      },
    })
      .then(async (rt) => {
        if (cancelled) {
          rt.stop();
          return;
        }
        started = rt;
        runtimeRef.current = rt;
        setRuntime(rt);
        setMode(rt.mode);
        setMessage(rt.message);
        setOnline(rt.connectivity.getState() === "online");
        offs.push(rt.connectivity.subscribe((s) => setOnline(s === "online")));
        const center = rt.center;
        if (center) {
          setStatus(center.getStatus());
          offs.push(center.subscribe(() => setStatus(center.getStatus())));
        }
        setCacheAge(await rt.readCacheAge());
        timer = setInterval(
          () => void rt.readCacheAge().then((age) => !cancelled && setCacheAge(age)),
          CACHE_AGE_EVERY_MS,
        );
        if (identity) void registerWorker().then((ok) => !cancelled && setRegisterFailed(!ok));
      })
      .catch(() => {
        if (!cancelled) {
          setMode("unavailable");
          setMessage("The device storage could not be started.");
        }
      });

    return () => {
      cancelled = true;
      for (const off of offs) off();
      if (timer !== null) clearInterval(timer);
      started?.stop();
    };
  }, [userId, businessId, businessName]);

  // The facts about the address, for the notice that says offline mode cannot start here. Nothing on the server (null), then the
  // browser's own answer, so the page the server made and the first page of the browser agree.
  const browser = useSyncExternalStore(subscribeNever, readAddressFacts, () => null);
  const worker: WorkerStatus = browser ? workerStatus({ ...browser, production: process.env.NODE_ENV === "production", registerFailed }) : "ok";

  // The names of the stores on this phone, so an order that is not yet on the server can show its store.
  const waitingKey = status ? status.items.map((i) => i.storeId).join(",") : "";
  useEffect(() => {
    const db = runtime?.db;
    if (!db) return;
    let cancelled = false;
    void db
      .getAll("stores")
      .then((rows) => {
        if (!cancelled) setStoreNames(Object.fromEntries(rows.map((s) => [s.id, s.name])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [runtime, waitingKey, cacheAge?.storesUpdatedAt]);

  const refresh = useCallback(async (): Promise<RefreshOutcome | null> => {
    if (!runtime) return null;
    setRefreshing(true);
    try {
      const outcome = await runtime.refresh(true);
      setStorageLow(outcome.status === "skipped" && outcome.reason === "storage_low");
      setCacheAge(await runtime.readCacheAge());
      return outcome;
    } finally {
      setRefreshing(false);
    }
  }, [runtime]);

  const recordPayment = useCallback<OfflineContextValue["recordPayment"]>(
    async (args) => {
      const center = runtime?.center;
      if (!center) return { ok: false, reason: "storage", message: NO_STORAGE_MESSAGE };
      return center.recordPayment(args);
    },
    [runtime],
  );
  const removePayment = useCallback(async (paymentId: string) => (runtime?.center ? runtime.center.removePayment(paymentId) : false), [runtime]);

  const value = useMemo<OfflineContextValue>(
    () => ({
      mode,
      message,
      online,
      status,
      cacheAge,
      storeNames,
      storageLow,
      refreshing,
      runtime,
      center: runtime?.center ?? null,
      refresh,
      worker,
      recordPayment,
      removePayment,
    }),
    [mode, message, online, status, cacheAge, storeNames, storageLow, refreshing, runtime, refresh, worker, recordPayment, removePayment],
  );

  const [store] = useState(createOfflineStore);
  useEffect(() => {
    store.set(value);
  }, [store, value]);

  return <OfflineContext.Provider value={store}>{children}</OfflineContext.Provider>;
}
