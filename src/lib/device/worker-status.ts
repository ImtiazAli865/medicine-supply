// Whether the offline worker (the service worker that keeps the app files for a reload without the internet) can run here,
// and the plain sentence to show when it cannot (Module 011, research D11). Pure: the browser facts are passed in.
//
// A service worker only runs on a secure address: https, or localhost on the same computer. A phone that opens the app on
// `http://192.168.x.x` gets no worker, and without this notice nothing would say why a reload without the internet fails.

export type WorkerStatus = "ok" | "insecure_address" | "unsupported" | "failed";

export interface WorkerInput {
  /** `window.isSecureContext`. */
  isSecureContext: boolean;
  /** `"serviceWorker" in navigator`. */
  hasServiceWorker: boolean;
  /** A production build. In a development build the worker is deliberately off, so nothing is reported. */
  production: boolean;
  /** The registration was tried and refused. */
  registerFailed: boolean;
}

export function workerStatus(input: WorkerInput): WorkerStatus {
  if (!input.production) return "ok";
  // A page on a plain http address has no service worker object at all: the address is the cause, so it is named first.
  if (!input.isSecureContext) return "insecure_address";
  if (!input.hasServiceWorker) return "unsupported";
  if (input.registerFailed) return "failed";
  return "ok";
}

export const WORKER_NOTICE: Record<Exclude<WorkerStatus, "ok">, string> = {
  insecure_address:
    "Offline mode cannot start on this address because it is not https. Use the https address of the app (or localhost on a computer) to work without the internet.",
  unsupported: "This browser cannot keep the app for use without the internet. The app works while you are online.",
  failed: "Offline mode could not start on this address. The app works while you are online. Reload the page to try again.",
};
