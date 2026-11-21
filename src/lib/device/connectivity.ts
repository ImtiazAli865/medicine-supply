// Online or offline, decided by real answers (Module 009, plan D9). `navigator.onLine` is only a hint: a phone on a Wi-Fi
// with no internet reports "online". A successful request of any kind means online; a network failure or a timeout means
// offline; while offline a small request (`GET /api/ping`) is repeated with growing waits and when the browser says the
// connection came back.

import { nextDelayMs } from "./backoff";

export type ConnectivityState = "online" | "offline";

export interface Scheduler {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface ConnectivityDeps {
  /** True when the server answered `GET /api/ping`. Must never throw. */
  ping: () => Promise<boolean>;
  scheduler?: Scheduler;
}

export interface Connectivity {
  getState(): ConnectivityState;
  subscribe(listener: (state: ConnectivityState) => void): () => void;
  /** Any request to the server succeeded. */
  reportSuccess(): void;
  /** A request failed with a network error or timed out. */
  reportFailure(): void;
  /** The browser's own online / offline events (hints). */
  browserOnline(): void;
  browserOffline(): void;
  /** Checks the server now (used on the browser's `online` event and by the Retry buttons). */
  probeNow(): Promise<void>;
  stop(): void;
}

const defaultScheduler: Scheduler = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createConnectivity(deps: ConnectivityDeps, initial: ConnectivityState = "online"): Connectivity {
  const scheduler = deps.scheduler ?? defaultScheduler;
  let state: ConnectivityState = initial;
  let attempt = 0;
  let timer: unknown = null;
  let probing = false;
  let stopped = false;
  const listeners = new Set<(s: ConnectivityState) => void>();

  function set(next: ConnectivityState) {
    if (state === next) return;
    state = next;
    for (const l of Array.from(listeners)) l(state);
  }

  function clearTimer() {
    if (timer !== null) {
      scheduler.clear(timer);
      timer = null;
    }
  }

  function scheduleProbe() {
    if (stopped || state !== "offline" || timer !== null) return;
    attempt += 1;
    timer = scheduler.set(() => {
      timer = null;
      void probeNow();
    }, nextDelayMs(attempt));
  }

  async function probeNow(): Promise<void> {
    if (stopped || probing) return;
    probing = true;
    clearTimer();
    let ok = false;
    try {
      ok = await deps.ping();
    } catch {
      ok = false;
    }
    probing = false;
    if (stopped) return;
    if (ok) {
      attempt = 0;
      set("online");
    } else {
      set("offline");
      scheduleProbe();
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reportSuccess() {
      if (stopped) return;
      clearTimer();
      attempt = 0;
      set("online");
    },
    reportFailure() {
      if (stopped) return;
      set("offline");
      scheduleProbe();
    },
    browserOnline() {
      void probeNow();
    },
    browserOffline() {
      if (stopped) return;
      set("offline");
      scheduleProbe();
    },
    probeNow,
    stop() {
      stopped = true;
      clearTimer();
      listeners.clear();
    },
  };
}
