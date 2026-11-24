import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGIN = "https://app.test";

class FakeCache {
  readonly entries = new Map<string, Response>();
  puts: string[] = [];
  private key(req: string | { url: string }) {
    const u = new URL(typeof req === "string" ? req : req.url, ORIGIN);
    return { path: u.pathname, full: u.pathname + u.search };
  }
  async put(req: string | { url: string }, res: Response) {
    const k = this.key(req).full;
    this.puts.push(k);
    this.entries.set(k, res);
  }
  async match(req: string | { url: string }, options?: { ignoreSearch?: boolean }) {
    const k = this.key(req);
    for (const [stored, res] of this.entries) {
      const sk = new URL(stored, ORIGIN);
      if (options?.ignoreSearch ? sk.pathname === k.path : stored === k.full) return res.clone();
    }
    return undefined;
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
    return this.caches.get(name)!;
  }
  async keys() {
    return [...this.caches.keys()];
  }
  async delete(name: string) {
    return this.caches.delete(name);
  }
}

type Handler = (event: Record<string, unknown>) => void;

function loadWorker(fetchImpl: (input: unknown, init?: { signal?: AbortSignal }) => Promise<Response>) {
  const listeners: Record<string, Handler> = {};
  const storage = new FakeCacheStorage();
  const claim = vi.fn(async () => undefined);
  const skipWaiting = vi.fn();
  const self = { location: { origin: ORIGIN }, addEventListener: (type: string, fn: Handler) => (listeners[type] = fn), skipWaiting, clients: { claim } };
  const source = readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
  new Function("self", "caches", "fetch", "Response", "URL", "AbortController", "setTimeout", "clearTimeout", source)(
    self,
    storage,
    fetchImpl,
    Response,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
  );
  return { listeners, storage, claim, skipWaiting };
}

function manifestFetch(files: string[], extra?: (url: string) => Response | undefined) {
  const calls: string[] = [];
  const impl = async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as { url: string }).url;
    calls.push(url);
    if (url === "/sw-assets.json") return new Response(JSON.stringify({ buildId: "b1", files }));
    const special = extra?.(url);
    if (special) return special;
    return new Response(`content of ${url}`);
  };
  return { impl, calls };
}

async function run(listener: Handler, event: Record<string, unknown>): Promise<Response | undefined> {
  let responded: Promise<Response> | undefined;
  let waited: Promise<unknown> | undefined;
  listener({ ...event, respondWith: (p: Promise<Response>) => (responded = p), waitUntil: (p: Promise<unknown>) => (waited = p) });
  if (waited) await waited;
  return responded ? await responded : undefined;
}

function request(url: string, init: { method?: string; mode?: string } = {}) {
  return { url: ORIGIN + url, method: init.method ?? "GET", mode: init.mode ?? "no-cors" };
}

describe("service worker", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps the listed files and the shell on install, takes over at once, and records the current build", async () => {
    const { impl, calls } = manifestFetch(["/_next/static/a.js", "/_next/static/b.css", "/offline"]);
    const w = loadWorker(impl);
    await run(w.listeners.install!, {});
    expect(w.skipWaiting).toHaveBeenCalled();
    expect(calls).toEqual(["/sw-assets.json", "/_next/static/a.js", "/_next/static/b.css", "/offline"]);
    const cache = w.storage.caches.get("medsupply-shell-b1")!;
    expect([...cache.entries.keys()].sort()).toEqual(["/_next/static/a.js", "/_next/static/b.css", "/offline"]);
    expect(await (await w.storage.caches.get("medsupply-meta")!.match("/__current-build"))!.text()).toBe("medsupply-shell-b1");
  });

  it("fails the install when a listed file cannot be fetched, so the previous worker stays in charge", async () => {
    const { impl } = manifestFetch(["/_next/static/a.js", "/_next/static/missing.js"], (u) => (u.endsWith("missing.js") ? new Response("no", { status: 404 }) : undefined));
    const w = loadWorker(impl);
    await expect(run(w.listeners.install!, {})).rejects.toThrow();
    expect(w.storage.caches.has("medsupply-meta")).toBe(false);
  });

  it("deletes the caches of older builds on activate, keeps the current one and unrelated caches, and claims the pages", async () => {
    const { impl } = manifestFetch(["/offline"]);
    const w = loadWorker(impl);
    await w.storage.open("medsupply-shell-old");
    await w.storage.open("other-app-cache");
    await run(w.listeners.install!, {});
    await run(w.listeners.activate!, {});
    expect([...w.storage.caches.keys()].sort()).toEqual(["medsupply-meta", "medsupply-shell-b1", "other-app-cache"]);
    expect(w.claim).toHaveBeenCalled();
  });

  it("never handles an API request, a non-GET request, a cross-origin request or a non-navigation page asset", async () => {
    const { impl } = manifestFetch(["/offline"]);
    const w = loadWorker(impl);
    await run(w.listeners.install!, {});
    for (const req of [
      request("/api/orders/o1"),
      request("/api/ping"),
      request("/api/stores", { method: "POST" }),
      { url: "https://elsewhere.test/_next/static/a.js", method: "GET", mode: "no-cors" },
      request("/some-data.json", { mode: "cors" }),
      request("/orders/new", { method: "POST", mode: "navigate" }),
    ]) {
      expect(await run(w.listeners.fetch!, { request: req })).toBeUndefined();
    }
  });

  it("answers a listed app file from the cache without the network, and asks the network for an unlisted one without keeping it", async () => {
    const { impl, calls } = manifestFetch(["/_next/static/a.js", "/offline"]);
    const w = loadWorker(impl);
    await run(w.listeners.install!, {});
    const before = calls.length;
    const hit = await run(w.listeners.fetch!, { request: request("/_next/static/a.js") });
    expect(await hit!.text()).toBe("content of /_next/static/a.js");
    expect(calls.length).toBe(before);
    const miss = await run(w.listeners.fetch!, { request: request("/_next/static/new.js") });
    expect(await miss!.text()).toBe("content of " + ORIGIN + "/_next/static/new.js");
    expect(w.storage.caches.get("medsupply-shell-b1")!.puts).not.toContain("/_next/static/new.js");
  });

  it("serves the shell page from the cache whatever the query", async () => {
    const { impl } = manifestFetch(["/offline"]);
    const w = loadWorker(impl);
    await run(w.listeners.install!, {});
    const res = await run(w.listeners.fetch!, { request: request("/offline?go=%2Forders", { mode: "navigate" }) });
    expect(await res!.text()).toBe("content of /offline");
  });

  it("returns a page that the network answered as it is and keeps nothing", async () => {
    let first = true;
    const impl = async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as { url: string }).url;
      if (first) {
        first = false;
        return new Response(JSON.stringify({ buildId: "b1", files: ["/offline"] }));
      }
      return new Response(url === "/offline" ? "shell" : "page from the server", { status: 200 });
    };
    const w = loadWorker(impl);
    await run(w.listeners.install!, {});
    const cache = w.storage.caches.get("medsupply-shell-b1")!;
    const putsBefore = cache.puts.length;
    const res = await run(w.listeners.fetch!, { request: request("/orders/new", { mode: "navigate" }) });
    expect(await res!.text()).toBe("page from the server");
    expect(cache.puts.length).toBe(putsBefore);
  });

  it("passes a server error page through untouched (only a failed request goes to the shell)", async () => {
    const impl = async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as { url: string }).url;
      if (url === "/sw-assets.json") return new Response(JSON.stringify({ buildId: "b1", files: ["/offline"] }));
      if (url === "/offline") return new Response("shell");
      return new Response("server error", { status: 500 });
    };
    const w = loadWorker(impl);
    await run(w.listeners.install!, {});
    const res = await run(w.listeners.fetch!, { request: request("/orders", { mode: "navigate" }) });
    expect(res!.status).toBe(500);
  });

  it("redirects a failed page request to the shell with the original path", async () => {
    let installed = false;
    const impl = async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as { url: string }).url;
      if (!installed) {
        if (url === "/sw-assets.json") return new Response(JSON.stringify({ buildId: "b1", files: ["/offline"] }));
        return new Response("shell");
      }
      throw new TypeError("Failed to fetch");
    };
    const w = loadWorker(impl);
    await run(w.listeners.install!, {});
    installed = true;
    const res = await run(w.listeners.fetch!, { request: request("/orders/123?store=abc", { mode: "navigate" }) });
    expect(res!.status).toBe(302);
    expect(res!.headers.get("Location")).toBe(`${ORIGIN}/offline?go=${encodeURIComponent("/orders/123?store=abc")}`);
  });

  it("redirects a page request that takes longer than 4 seconds", async () => {
    vi.useFakeTimers();
    let installed = false;
    const impl = (input: unknown, init?: { signal?: AbortSignal }) => {
      const url = typeof input === "string" ? input : (input as { url: string }).url;
      if (!installed) {
        return Promise.resolve(url === "/sw-assets.json" ? new Response(JSON.stringify({ buildId: "b1", files: ["/offline"] })) : new Response("shell"));
      }
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    };
    const w = loadWorker(impl);
    const install = run(w.listeners.install!, {});
    await vi.runAllTimersAsync();
    await install;
    installed = true;
    const pending = run(w.listeners.fetch!, { request: request("/orders", { mode: "navigate" }) });
    await vi.advanceTimersByTimeAsync(3_999);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const res = await pending;
    expect(res!.status).toBe(302);
  });

  it("mentions /api/ only to stay away from it and caches only listed files", () => {
    const source = readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code.match(/\/api\//g)?.length).toBe(1);
    expect(code).toContain('startsWith("/api/")');
    expect(code).not.toMatch(/localStorage|indexedDB|\.add\(/);
    // the only cache writes are the listed files and the current-build marker
    expect((code.match(/\.put\(/g) ?? []).length).toBe(2);
  });
});
