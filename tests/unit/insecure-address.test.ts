import { describe, expect, it } from "vitest";
import { WORKER_NOTICE, workerStatus, type WorkerInput } from "@/lib/device/worker-status";

// The warning shown when the offline worker cannot start (Module 011, research D11).

const ok: WorkerInput = { isSecureContext: true, hasServiceWorker: true, production: true, registerFailed: false };

describe("the status of the offline worker", () => {
  it("is ok on https and on localhost (both are secure contexts) in a production build", () => {
    expect(workerStatus(ok)).toBe("ok");
  });

  it("says the address is not secure on a plain http address such as a phone reaching a computer on the network", () => {
    // In that case the browser also hides the service worker object, so the address is named first, not "unsupported".
    expect(workerStatus({ ...ok, isSecureContext: false, hasServiceWorker: false })).toBe("insecure_address");
    expect(workerStatus({ ...ok, isSecureContext: false })).toBe("insecure_address");
  });

  it("says unsupported when a secure page still has no service worker (an old or restricted browser)", () => {
    expect(workerStatus({ ...ok, hasServiceWorker: false })).toBe("unsupported");
  });

  it("says failed when the registration failed on a secure address", () => {
    expect(workerStatus({ ...ok, registerFailed: true })).toBe("failed");
  });

  it("never warns in a development build, where the worker is deliberately off", () => {
    for (const secure of [true, false]) {
      expect(workerStatus({ isSecureContext: secure, hasServiceWorker: secure, production: false, registerFailed: !secure })).toBe("ok");
    }
  });

  it("has a different plain sentence for each warning, none of which is about money", () => {
    expect(WORKER_NOTICE.insecure_address).toBe(
      "Offline mode cannot start on this address because it is not https. Use the https address of the app (or localhost on a computer) to work without the internet.",
    );
    expect(WORKER_NOTICE.failed).not.toBe(WORKER_NOTICE.insecure_address);
    expect(WORKER_NOTICE.unsupported).not.toBe(WORKER_NOTICE.failed);
    for (const text of Object.values(WORKER_NOTICE)) expect(text).not.toMatch(/balance|invoice|ledger|price|cost|profit|margin|mrp/i);
  });
});
