import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDeviceStorage } from "../helpers/memory-storage";
import { createConnectivity, type Connectivity } from "@/lib/device/connectivity";
import type { LeaderElection } from "@/lib/device/locks";
import type { BusinessDatabase, StoreOpPayload } from "@/lib/device/schema";
import { SyncCenter, type SendResult, type StoreSendResult } from "@/lib/device/sync-center";
import type { SaveRequest } from "@/lib/orders/autosave";
import type { EditorState } from "@/lib/orders/editor-state";
import type { Order } from "@/lib/orders/types";

// Stores made offline (Module 009, US4): created before the orders that use them, never merged silently, never replaced by
// another store, and typed lines are sent exactly as typed.

const BIZ = "123e4567-e89b-42d3-a456-426614174000";

const election: LeaderElection = { isLeader: () => true, subscribe: () => () => undefined, stop: () => undefined };

class FakeServer {
  calls: string[] = [];
  storeScript: Array<"ok" | "similar" | "400" | "5xx"> = [];
  stores = new Map<string, { name: string; confirmed: boolean }>();
  orderStore = new Map<string, string>();
  orderLines = new Map<string, EditorState["lines"]>();
  similarMatches = [{ id: "existing-store", name: "Existing Pharmacy" }];

  async sendStore(payload: StoreOpPayload, confirmDuplicate: boolean): Promise<StoreSendResult> {
    this.calls.push(`store:${payload.name}:${confirmDuplicate ? "confirmed" : "plain"}`);
    const step = this.storeScript.shift() ?? "ok";
    if (step === "5xx") return { kind: "retryable", message: "Server error" };
    if (step === "400") return { kind: "fatal", message: "This store name is not valid." };
    if (step === "similar" && !confirmDuplicate) return { kind: "similar", matches: this.similarMatches };
    this.stores.set(payload.id, { name: payload.name, confirmed: confirmDuplicate });
    return { kind: "ok" };
  }

  async sendOrder(orderId: string, request: SaveRequest<EditorState>): Promise<SendResult> {
    this.calls.push(`order:${orderId}:${request.state.storeId}`);
    if (!this.stores.has(request.state.storeId) && request.state.storeId !== "existing-store") {
      return { kind: "fatal", message: "This store was not found.", reason: "store_problem" } as SendResult;
    }
    this.orderStore.set(orderId, request.state.storeId);
    this.orderLines.set(orderId, request.state.lines);
    return { kind: "ok", version: 1, savedAt: "t", order: { id: orderId, version: 1, updated_at: "t", status: "draft", lines: [], store: { id: request.state.storeId, name: "S", is_active: true } } as unknown as Order };
  }
}

let storage: MemoryDeviceStorage;
let db: BusinessDatabase;
let server: FakeServer;
let connectivity: Connectivity;
let counter: number;
const centers: SyncCenter[] = [];

function makeCenter() {
  const center = new SyncCenter({
    db,
    connectivity,
    election,
    transport: (orderId, request) => server.sendOrder(orderId, request),
    storeTransport: (payload, confirm) => server.sendStore(payload, confirm),
    scheduler: { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    newId: () => `id-${++counter}`,
    nowText: () => "10:00",
    debounceMs: 100,
  });
  centers.push(center);
  return center;
}

async function settle(ms = 500) {
  await vi.advanceTimersByTimeAsync(ms);
}

async function orderFor(center: SyncCenter, orderId: string, storeId: string) {
  const handle = await center.openDraft({ orderId, serverOrder: null, storeId, lineInfo: {} });
  handle.machine.edit({ storeId, notes: "", lines: [{ id: `l-${orderId}`, product_id: null, name: "Typed Cough Syrup", quantity: 3, unit: "bottle" }] });
  return handle;
}

beforeEach(async () => {
  vi.useFakeTimers();
  storage = new MemoryDeviceStorage();
  const r = await storage.openBusiness(BIZ);
  if (!r.ok) throw new Error("open failed");
  db = r.db;
  server = new FakeServer();
  counter = 0;
  connectivity = createConnectivity({ ping: async () => true });
  connectivity.reportFailure(); // start offline
});

afterEach(() => {
  for (const c of centers.splice(0)) c.stop();
  vi.useRealTimers();
});

describe("stores made offline", () => {
  it("keeps the new store on the phone, selectable at once, and marks it as not yet on the server", async () => {
    const center = makeCenter();
    await center.start();
    const store = await center.createStore({ name: "Made Offline Pharmacy", phone: "0300" });
    expect(store).toMatchObject({ name: "Made Offline Pharmacy", pending: true, is_active: true });
    expect((await db.get("stores", store!.id))?.pending).toBe(true);
    expect((await db.get("storeOps", store!.id))?.state).toBe("on_device");
    expect(center.getStatus().pendingStoreIds).toEqual([store!.id]);
    expect(center.getStatus().counts.waiting).toBe(1);
  });

  it("creates the store first and then the orders that use it, once each", async () => {
    const center = makeCenter();
    await center.start();
    const store = (await center.createStore({ name: "Made Offline Pharmacy" }))!;
    await orderFor(center, "o1", store.id);
    await settle(500);
    expect(server.calls).toEqual([]); // offline: nothing is sent
    expect(center.getStatus().counts).toMatchObject({ waiting: 1, blocked: 1 });

    connectivity.reportSuccess();
    await settle(2_000);
    expect(server.calls).toEqual([`store:Made Offline Pharmacy:plain`, `order:o1:${store.id}`]);
    expect(center.getStatus().counts).toEqual({ waiting: 0, syncing: 0, failed: 0, conflict: 0, blocked: 0 });
    expect(center.getStatus().pendingStoreIds).toEqual([]);
    expect((await db.get("stores", store.id))?.pending).toBe(false);
  });

  it("sends typed lines exactly as typed", async () => {
    const center = makeCenter();
    await center.start();
    const store = (await center.createStore({ name: "Typed Store" }))!;
    await orderFor(center, "o1", store.id);
    connectivity.reportSuccess();
    await settle(2_000);
    expect(server.orderLines.get("o1")).toEqual([{ id: "l-o1", product_id: null, name: "Typed Cough Syrup", quantity: 3, unit: "bottle" }]);
  });

  it("keeps the orders blocked when the store cannot be created, and never attaches them to another store", async () => {
    server.storeScript = ["400"];
    const center = makeCenter();
    await center.start();
    const store = (await center.createStore({ name: "Bad Store" }))!;
    await orderFor(center, "o1", store.id);
    connectivity.reportSuccess();
    await settle(3_000);
    expect(server.calls.filter((c) => c.startsWith("order:"))).toEqual([]);
    expect(center.getStatus().items.find((i) => i.kind === "store")).toMatchObject({ state: "failed", reason: "This store name is not valid." });
    expect(center.getStatus().items.find((i) => i.kind === "order")).toMatchObject({ state: "blocked" });
    expect((await db.get("drafts", "o1"))?.state.storeId).toBe(store.id);
  });

  it("asks when the server finds a similar store, and merges nothing until the supplier answers", async () => {
    server.storeScript = ["similar"];
    const center = makeCenter();
    await center.start();
    const store = (await center.createStore({ name: "Existing Pharmacy " }))!;
    await orderFor(center, "o1", store.id);
    connectivity.reportSuccess();
    await settle(2_000);
    const item = center.getStatus().items.find((i) => i.kind === "store");
    expect(item).toMatchObject({ state: "similar", matches: [{ id: "existing-store", name: "Existing Pharmacy" }] });
    expect(server.stores.size).toBe(0); // nothing created, nothing merged
    expect(server.calls.filter((c) => c.startsWith("order:"))).toEqual([]);
    await settle(10_000);
    expect(server.stores.size).toBe(0);
  });

  it("'use the existing store' moves the waiting orders to that store only after the supplier chose it", async () => {
    server.storeScript = ["similar"];
    const center = makeCenter();
    await center.start();
    const store = (await center.createStore({ name: "Existing Pharmacy " }))!;
    await orderFor(center, "o1", store.id);
    connectivity.reportSuccess();
    await settle(2_000);
    await center.resolveSimilar(store.id, { choice: "use_existing", existingId: "existing-store" });
    await settle(2_000);
    expect(server.calls.filter((c) => c.startsWith("order:"))).toEqual(["order:o1:existing-store"]);
    expect(await db.get("storeOps", store.id)).toBeUndefined();
    expect((await db.get("stores", store.id))).toBeUndefined();
    expect(server.stores.size).toBe(0);
  });

  it("'create a new store anyway' repeats the create with the duplicate confirmed, then sends the order", async () => {
    server.storeScript = ["similar"];
    const center = makeCenter();
    await center.start();
    const store = (await center.createStore({ name: "Existing Pharmacy " }))!;
    await orderFor(center, "o1", store.id);
    connectivity.reportSuccess();
    await settle(2_000);
    await center.resolveSimilar(store.id, { choice: "create_anyway" });
    await settle(2_000);
    expect(server.calls).toContain("store:Existing Pharmacy:confirmed");
    expect(server.calls.filter((c) => c.startsWith("order:"))).toEqual([`order:o1:${store.id}`]);
  });

  it("resumes after a restart: the store and its order are still waiting and are sent in order", async () => {
    const first = makeCenter();
    await first.start();
    const store = (await first.createStore({ name: "Restart Store" }))!;
    await orderFor(first, "o1", store.id);
    await settle(300);
    first.stop();
    const second = makeCenter();
    await second.start();
    expect(second.getStatus().pendingStoreIds).toEqual([store.id]);
    expect(second.getStatus().counts).toMatchObject({ waiting: 1, blocked: 1 });
    connectivity.reportSuccess();
    await settle(2_000);
    expect(server.calls).toEqual([`store:Restart Store:plain`, `order:o1:${store.id}`]);
  });
});
