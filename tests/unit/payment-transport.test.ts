import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientApiError } from "@/lib/api/client";
import { sendPaymentTransport } from "@/lib/device/payment-transport";
import { newPaymentOp } from "@/lib/device/payments";

const fetchJson = vi.fn();
vi.mock("@/lib/api/client", async (original) => ({ ...(await original<typeof import("@/lib/api/client")>()), fetchJson: (...args: unknown[]) => fetchJson(...args) }));

const STORE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";

function op(storeId = STORE, reference: string | null = "R-7") {
  return newPaymentOp({ paymentId: ID, storeId, input: { amount: "5000.00", date: "2026-11-24", reference }, seq: 1, recordedOn: "10:00" });
}

function refused(code: string, status: number, message = "Server message.", fields?: Record<string, string>) {
  return new ClientApiError(code as never, status, message, { code, message, fields } as never);
}

// A rejection is made when the mock is called, not when it is set up (an early rejected promise is reported as unhandled).
const fails = (error: unknown) =>
  fetchJson.mockImplementation(async () => {
    throw error;
  });
const failsOnce = (error: unknown) =>
  fetchJson.mockImplementationOnce(async () => {
    throw error;
  });

// Braces matter: a function returned from beforeEach would be run by vitest as a cleanup after the test.
beforeEach(() => {
  fetchJson.mockReset();
});

describe("sending a waiting payment", () => {
  it("posts the payment with its own key to its own store and keeps a 401 from navigating away", async () => {
    fetchJson.mockResolvedValue({ status: 200, data: { done: true, account: { balance: "1.00" } } });
    expect(await sendPaymentTransport(op())).toEqual({ kind: "ok" });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const [url, options] = fetchJson.mock.calls[0]!;
    expect(url).toBe(`/api/accounts/${STORE}/payments`);
    expect(options).toEqual({ json: { id: ID, amount: "5000.00", date: "2026-11-24", method: "cash", reference: "R-7" }, onUnauthorized: "event" });
  });

  it("sends a missing reference as null", async () => {
    fetchJson.mockResolvedValue({ status: 200, data: { done: true } });
    await sendPaymentTransport(op(STORE, null));
    expect(fetchJson.mock.calls[0]![1].json.reference).toBeNull();
  });

  it("counts a repeat of a payment the server already holds as recorded", async () => {
    fetchJson.mockResolvedValue({ status: 200, data: { done: true, replayed: true } });
    expect(await sendPaymentTransport(op())).toEqual({ kind: "ok" });
  });

  it("sends the same key again on a retry and never another store's id", async () => {
    failsOnce(refused("network", 0, "Can't reach the server."));
    fetchJson.mockResolvedValueOnce({ status: 200, data: { done: true } });
    const payment = op();
    expect((await sendPaymentTransport(payment)).kind).toBe("retryable");
    expect((await sendPaymentTransport(payment)).kind).toBe("ok");
    const calls = fetchJson.mock.calls;
    expect(calls.map((c) => c[1].json.id)).toEqual([ID, ID]);
    expect(calls.map((c) => c[0])).toEqual([`/api/accounts/${STORE}/payments`, `/api/accounts/${STORE}/payments`]);
    expect(calls.some((c) => String(c[0]).includes(OTHER))).toBe(false);
  });

  const retryable: Array<[string, string, number]> = [
    ["no network", "network", 0],
    ["a gateway error", "server_error", 502],
    ["a gateway error", "server_error", 503],
    ["a gateway timeout", "server_error", 504],
    ["a server error", "server_error", 500],
    ["too many requests", "rate_limited", 429],
    ["a request timeout", "server_error", 408],
  ];
  for (const [name, code, status] of retryable) {
    it(`waits and tries again after ${name} (${status})`, async () => {
      fails(refused(code, status, "Try again."));
      expect(await sendPaymentTransport(op())).toEqual({ kind: "retryable", message: "Try again." });
    });
  }

  it("reports a 401 as unauthorized", async () => {
    fails(refused("unauthenticated", 401, "Your session expired."));
    expect(await sendPaymentTransport(op())).toEqual({ kind: "unauthorized" });
  });

  it("makes a conflict of a store the server does not know", async () => {
    fails(refused("not_found", 404, "Not found."));
    expect(await sendPaymentTransport(op())).toEqual({ kind: "conflict", conflict: "not_found", message: "This store is not on the server." });
  });

  it("makes a conflict of a key that holds different content", async () => {
    fails(refused("request_reused", 409, "This request was already used for a different entry."));
    expect(await sendPaymentTransport(op())).toEqual({
      kind: "conflict",
      conflict: "request_reused",
      message: "A payment with this key but other details already exists. Check the store's account.",
    });
  });

  for (const field of ["amount", "date", "reference"]) {
    it(`makes a refused conflict with the server's ${field} message`, async () => {
      fails(refused("validation_error", 400, "Refused.", { [field]: `Bad ${field}.` }));
      expect(await sendPaymentTransport(op())).toEqual({ kind: "conflict", conflict: "refused", message: `Bad ${field}.` });
    });
  }

  it("makes a refused conflict with the server's message when no field is named", async () => {
    fails(refused("validation_error", 400, "This id cannot be used."));
    expect(await sendPaymentTransport(op())).toEqual({ kind: "conflict", conflict: "refused", message: "This id cannot be used." });
  });

  it("never drops a payment that another 4xx answer refuses: it becomes a refused conflict", async () => {
    fails(refused("forbidden", 403, "Not allowed."));
    expect(await sendPaymentTransport(op())).toEqual({ kind: "conflict", conflict: "refused", message: "Not allowed." });
  });

  it("does not hide an unexpected error", async () => {
    fails(new TypeError("boom"));
    await expect(sendPaymentTransport(op())).rejects.toThrow("boom");
  });
});
