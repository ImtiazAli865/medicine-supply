import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientApiError, fetchJson, GET_TIMEOUT_MS, SESSION_EXPIRED_EVENT, setConnectivityReporter, setLocalAnswerHook, WRITE_TIMEOUT_MS } from "@/lib/api/client";

const reporter = { reportSuccess: vi.fn(), reportFailure: vi.fn() };
const assign = vi.fn();
const dispatchEvent = vi.fn();

type FetchImpl = (url: string, init: { method?: string; signal?: AbortSignal }) => Promise<Response>;

function stubFetch(impl: FetchImpl) {
  vi.stubGlobal("fetch", impl);
}

function hangingFetch(): FetchImpl {
  return (_url, init) =>
    new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
}

beforeEach(() => {
  vi.useFakeTimers();
  reporter.reportSuccess.mockClear();
  reporter.reportFailure.mockClear();
  assign.mockClear();
  dispatchEvent.mockClear();
  vi.stubGlobal("document", { querySelector: () => null });
  vi.stubGlobal("window", { location: { pathname: "/orders", search: "", assign }, dispatchEvent });
  setConnectivityReporter(reporter);
  setLocalAnswerHook(null);
});

afterEach(() => {
  setConnectivityReporter(null);
  setLocalAnswerHook(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchJson timeouts and reporting", () => {
  it("turns a GET that gets no answer in 15 seconds into a network error", async () => {
    stubFetch(hangingFetch());
    const result = fetchJson("/api/stores").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(GET_TIMEOUT_MS - 1);
    let settled = false;
    void result.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const error = await result;
    expect(error).toBeInstanceOf(ClientApiError);
    expect((error as ClientApiError).code).toBe("network");
    expect(reporter.reportFailure).toHaveBeenCalled();
  });

  it("gives a write 20 seconds", async () => {
    stubFetch(hangingFetch());
    const result = fetchJson("/api/orders/o1", { method: "PUT", json: {} }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(GET_TIMEOUT_MS + 1_000);
    let settled = false;
    void result.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS - GET_TIMEOUT_MS);
    expect(((await result) as ClientApiError).code).toBe("network");
  });

  it("reports a successful answer and returns it, ignoring the device hook", async () => {
    const hook = vi.fn(async () => ({ status: 200, body: { items: ["from the device"] } }));
    setLocalAnswerHook(hook);
    stubFetch(async () => new Response(JSON.stringify({ items: ["from the server"] }), { status: 200 }));
    const answer = await fetchJson<{ items: string[] }>("/api/stores");
    expect(answer).toEqual({ status: 200, data: { items: ["from the server"] } });
    expect(answer.source).toBeUndefined();
    expect(hook).not.toHaveBeenCalled();
    expect(reporter.reportSuccess).toHaveBeenCalled();
  });

  it("reports an error answer from the server as online, but a gateway error as a failure", async () => {
    stubFetch(async () => new Response(JSON.stringify({ code: "validation_error", message: "Bad" }), { status: 400 }));
    await expect(fetchJson("/api/stores")).rejects.toMatchObject({ code: "validation_error", status: 400 });
    expect(reporter.reportSuccess).toHaveBeenCalledTimes(1);
    stubFetch(async () => new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(fetchJson("/api/stores")).rejects.toMatchObject({ status: 502 });
    expect(reporter.reportFailure).toHaveBeenCalledTimes(1);
  });

  it("treats an answer whose body never finishes as a network failure, not as a success with no data", async () => {
    stubFetch(async (_url, init) => {
      const body = new ReadableStream({
        start(controller) {
          init.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const result = fetchJson("/api/stores").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(GET_TIMEOUT_MS + 10);
    expect(((await result) as ClientApiError).code).toBe("network");
  });
});

describe("answers from the device copy", () => {
  it("answers a GET from the device when the network fails, and says so", async () => {
    setLocalAnswerHook(async (method, url) => (method === "GET" && url.startsWith("/api/stores") ? { status: 200, body: { items: [], next_cursor: null } } : null));
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const answer = await fetchJson("/api/stores?status=active");
    expect(answer).toEqual({ status: 200, data: { items: [], next_cursor: null }, source: "device" });
    expect(reporter.reportFailure).toHaveBeenCalled();
  });

  it("never uses the device for a write or for a path the hook does not answer", async () => {
    const hook = vi.fn(async () => null);
    setLocalAnswerHook(hook);
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchJson("/api/orders/o1", { method: "PUT", json: {} })).rejects.toMatchObject({ code: "network" });
    await expect(fetchJson("/api/stores", { json: { id: "x" } })).rejects.toMatchObject({ code: "network" });
    expect(hook).not.toHaveBeenCalled();
    await expect(fetchJson("/api/invoices")).rejects.toMatchObject({ code: "network" });
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it("turns an error answer of the device into an error like a real one, with its message", async () => {
    setLocalAnswerHook(async () => ({ status: 503, body: { code: "server_error", message: "This store's usual medicines list is not saved on this phone yet." } }));
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchJson("/api/orders/usual?store_id=s1")).rejects.toMatchObject({ code: "server_error", status: 503, message: expect.stringContaining("not saved on this phone yet") });
  });

  it("keeps the real network error when the hook throws", async () => {
    setLocalAnswerHook(async () => {
      throw new Error("db closed");
    });
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchJson("/api/stores")).rejects.toMatchObject({ code: "network" });
  });
});

describe("401 handling", () => {
  const unauthorized = async () => new Response(JSON.stringify({ code: "unauthenticated", message: "x" }), { status: 401 });

  it("goes to the sign-in page by default when no form is on screen (as before)", async () => {
    stubFetch(unauthorized);
    await expect(fetchJson("/api/orders")).rejects.toMatchObject({ code: "unauthenticated" });
    expect(assign).toHaveBeenCalledTimes(1);
    expect(String(assign.mock.calls[0]![0])).toContain("/sign-in?next=");
  });

  it("only tells the page, and never navigates, with onUnauthorized 'event'", async () => {
    stubFetch(unauthorized);
    await expect(fetchJson("/api/orders/o1", { method: "PUT", json: {}, onUnauthorized: "event" })).rejects.toMatchObject({ code: "unauthenticated" });
    expect(assign).not.toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect((dispatchEvent.mock.calls[0]![0] as Event).type).toBe(SESSION_EXPIRED_EVENT);
  });
});

describe("cancelling", () => {
  it("rethrows the caller's own abort and does not report a network failure", async () => {
    stubFetch(hangingFetch());
    const caller = new AbortController();
    const result = fetchJson("/api/stores", { signal: caller.signal }).catch((e: unknown) => e);
    caller.abort();
    const error = await result;
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
    expect(reporter.reportFailure).not.toHaveBeenCalled();
  });
});
