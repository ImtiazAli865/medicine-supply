import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDeviceStorage } from "../helpers/memory-storage";
import { createConnectivity, type Connectivity } from "@/lib/device/connectivity";
import type { LeaderElection } from "@/lib/device/locks";
import type { BusinessDatabase } from "@/lib/device/schema";
import { SyncCenter, type SendResult } from "@/lib/device/sync-center";
import type { EditorState } from "@/lib/orders/editor-state";
import type { SaveRequest } from "@/lib/orders/autosave";
import type { Order } from "@/lib/orders/types";

const BIZ = "123e4567-e89b-42d3-a456-426614174000";

class FakeElection implements LeaderElection {
  leader = true;
  private readonly listeners = new Set<(l: boolean) => void>();
  isLeader() {
    return this.leader;
  }
  subscribe(l: (leader: boolean) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  set(v: boolean) {
    this.leader = v;
    for (const l of this.listeners) l(v);
  }
  stop() {
    this.listeners.clear();
  }
}

/** A server that applies a request id once, checks versions, and can fail, refuse, lose a response or answer 401. */
class FakeServer {
  versions = new Map<string, number>();
  applied = new Map<string, { orderId: string; version: number }>();
  received: Array<{ orderId: string; requestId: string; expected: number | null; lines: number }> = [];
  script: Array<"ok" | "5xx" | "400" | "401" | "lose-response" | "conflict"> = [];
  /** Per order script (takes priority). */
  perOrder = new Map<string, Array<"ok" | "5xx" | "400" | "401" | "lose-response" | "conflict">>();
  delayMs = 0;

  async send(orderId: string, request: SaveRequest<EditorState>): Promise<SendResult> {
    this.received.push({ orderId, requestId: request.requestId, expected: request.expectedVersion, lines: request.state.lines.length });
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    const step = this.perOrder.get(orderId)?.shift() ?? this.script.shift() ?? "ok";
    if (step === "5xx") return { kind: "retryable", message: "Server error" };
    if (step === "400") return { kind: "fatal", message: "This medicine is no longer available." };
    if (step === "401") return { kind: "unauthorized" };
    if (step === "conflict") return { kind: "conflict", current: this.order(orderId, 50) };
    const already = this.applied.get(request.requestId);
    if (!already) {
      const current = this.versions.get(orderId) ?? null;
      if (request.expectedVersion !== current) return { kind: "conflict", current: this.order(orderId, current ?? 0) };
      const version = (current ?? 0) + 1;
      this.versions.set(orderId, version);
      this.applied.set(request.requestId, { orderId, version });
    }
    if (step === "lose-response") return { kind: "retryable", message: "Can't reach the server." };
    const version = this.applied.get(request.requestId)!.version;
    return { kind: "ok", version, savedAt: `saved-${version}`, order: this.order(orderId, version) };
  }

  order(id: string, version: number): Order {
    return { id, version, order_number: version, updated_at: `saved-${version}`, status: "draft", lines: [], store: { id: "s1", name: "S", is_active: true } } as unknown as Order;
  }
}

let storage: MemoryDeviceStorage;
let db: BusinessDatabase;
let server: FakeServer;
let election: FakeElection;
let connectivity: Connectivity;
let online: boolean;
let counter: number;
const centers: SyncCenter[] = [];

function state(storeId = "s1", quantity = 1): EditorState {
  return { storeId, notes: "", lines: [{ id: `l${quantity}`, product_id: null, name: "Typed", quantity, unit: "strip" }] };
}

function makeCenter(options: { db?: BusinessDatabase; election?: FakeElection } = {}) {
  const center = new SyncCenter({
    db: options.db ?? db,
    connectivity,
    election: options.election ?? election,
    transport: (orderId, request) => server.send(orderId, request),
    scheduler: { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    newId: () => `req-${++counter}`,
    nowText: () => "10:00",
    debounceMs: 100,
  });
  centers.push(center);
  return center;
}

async function openAndEdit(center: SyncCenter, orderId: string, quantity = 1) {
  const handle = await center.openDraft({ orderId, serverOrder: null, storeId: "s1", lineInfo: {} });
  handle.machine.edit(state("s1", quantity));
  return handle;
}

async function settle(ms = 500) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(async () => {
  vi.useFakeTimers();
  storage = new MemoryDeviceStorage();
  const r = await storage.openBusiness(BIZ);
  if (!r.ok) throw new Error("open failed");
  db = r.db;
  server = new FakeServer();
  election = new FakeElection();
  online = true;
  counter = 0;
  connectivity = createConnectivity({ ping: async () => online });
});

afterEach(() => {
  for (const c of centers.splice(0)) c.stop();
  vi.useRealTimers();
});

describe("sync centre: sending", () => {
  it("keeps an offline change on the device, then sends it when the connection returns, once", async () => {
    connectivity.reportFailure();
    const center = makeCenter();
    await center.start();
    const handle = await openAndEdit(center, "o1");
    await settle(1_000);
    expect(server.received).toHaveLength(0);
    expect(handle.machine.getSnapshot().status).toBe("on_device");
    expect(center.getStatus()).toMatchObject({ online: false, counts: { waiting: 1 } });
    expect((await db.get("drafts", "o1"))?.syncState).toBe("on_device");

    online = true;
    connectivity.reportSuccess();
    await settle(1_000);
    expect(server.received.filter((r) => r.orderId === "o1")).toHaveLength(1);
    expect(handle.machine.getSnapshot().status).toBe("saved");
    expect(center.getStatus().counts).toEqual({ waiting: 0, syncing: 0, failed: 0, conflict: 0, blocked: 0 });
    expect((await db.get("drafts", "o1"))?.syncState).toBe("synced");
    expect(center.getStatus().lastSyncAt).toBe("10:00");
  });

  it("sends the waiting drafts in the order they were first changed", async () => {
    connectivity.reportFailure();
    const center = makeCenter();
    await center.start();
    await openAndEdit(center, "c");
    await settle(300);
    await openAndEdit(center, "a");
    await settle(300);
    await openAndEdit(center, "b");
    await settle(300);
    server.received.length = 0;
    connectivity.reportSuccess();
    await settle(2_000);
    expect(server.received.map((r) => r.orderId)).toEqual(["c", "a", "b"]);
  });

  it("resumes after a restart: the unresolved request is repeated with the same id and the server applies it once", async () => {
    // First session: the request reaches the server but the answer is lost, then the app is closed.
    server.script = ["lose-response", "5xx", "5xx", "5xx"];
    const first = makeCenter();
    await first.start();
    await openAndEdit(first, "o1");
    await settle(5_000);
    const firstIds = new Set(server.received.map((r) => r.requestId));
    expect(firstIds.size).toBe(1);
    first.stop();

    // Second session on the same device storage.
    server.script = [];
    const second = makeCenter();
    await second.start();
    await settle(3_000);
    const ids = server.received.map((r) => r.requestId);
    expect(new Set(ids).size).toBe(1);
    expect(server.versions.get("o1")).toBe(1);
    expect((await db.get("drafts", "o1"))?.syncState).toBe("synced");
  });

  it("waits longer after each failure (2 s, 5 s, 15 s) and the Retry button tries at once", async () => {
    server.script = Array.from({ length: 30 }, () => "5xx" as const);
    const center = makeCenter();
    await center.start();
    await openAndEdit(center, "o1");
    // 3 quick attempts inside the machine, then the centre's backoff takes over
    await settle(100 + 3 * 1000 + 50);
    const afterFirstRound = server.received.length;
    expect(afterFirstRound).toBe(3);
    await settle(1_900);
    expect(server.received.length).toBe(afterFirstRound);
    await settle(200);
    expect(server.received.length).toBeGreaterThan(afterFirstRound);
    const before = server.received.length;
    center.retry("o1");
    await settle(50);
    expect(server.received.length).toBeGreaterThan(before);
  });

  it("does not let a draft that fails block an unrelated draft", async () => {
    server.perOrder.set("bad", ["400"]);
    const center = makeCenter();
    await center.start();
    await openAndEdit(center, "bad");
    await openAndEdit(center, "good");
    await settle(2_000);
    expect(server.versions.get("good")).toBe(1);
    expect(center.getStatus().counts).toMatchObject({ failed: 1, waiting: 0 });
    expect(center.getStatus().items[0]).toMatchObject({ orderId: "bad", state: "failed", reason: "This medicine is no longer available." });
    expect((await db.get("drafts", "bad"))?.state.lines).toHaveLength(1); // still on the phone, untouched
  });

  it("sends an edit made during a send after the first request finished", async () => {
    server.delayMs = 400;
    const center = makeCenter();
    await center.start();
    const handle = await openAndEdit(center, "o1", 1);
    await settle(150);
    expect(center.getStatus().counts.syncing).toBe(1);
    handle.machine.edit(state("s1", 2));
    await settle(2_000);
    expect(server.received.map((r) => [r.requestId, r.expected])).toEqual([
      ["req-1", null],
      ["req-2", 1],
    ]);
    expect(handle.machine.getSnapshot().status).toBe("saved");
  });

  it("never shows an item as sent before the server answered", async () => {
    server.delayMs = 1_000;
    const center = makeCenter();
    await center.start();
    const handle = await openAndEdit(center, "o1");
    await settle(300);
    expect(handle.machine.getSnapshot().status).toBe("saving");
    expect(center.getStatus().counts.syncing).toBe(1);
    expect((await db.get("drafts", "o1"))?.syncState).toBe("on_device");
    await settle(1_500);
    expect((await db.get("drafts", "o1"))?.syncState).toBe("synced");
  });
});

describe("sync centre: controls and conditions", () => {
  it("pauses and resumes sending, and remembers the pause", async () => {
    const center = makeCenter();
    await center.start();
    await center.pause();
    await openAndEdit(center, "o1");
    await settle(2_000);
    expect(server.received).toHaveLength(0);
    expect(center.getStatus().paused).toBe(true);
    expect((await db.get("meta", "sendingPaused"))?.value).toBe(true);
    await center.resume();
    await settle(1_000);
    expect(server.versions.get("o1")).toBe(1);
    expect(center.getStatus().paused).toBe(false);
  });

  it("stops on a 401, keeps every item, and sends after the same user signs in again", async () => {
    server.script = ["401"];
    const center = makeCenter();
    await center.start();
    await openAndEdit(center, "o1");
    await settle(4_000);
    expect(center.getStatus()).toMatchObject({ needsSignIn: true, counts: { waiting: 1 } });
    const sent = server.received.length;
    await settle(10_000);
    expect(server.received.length).toBe(sent); // nothing more is sent while sign-in is needed
    expect((await db.get("drafts", "o1"))?.syncState).toBe("on_device");
    center.signedIn();
    await settle(1_000);
    expect(server.versions.get("o1")).toBe(1);
    expect(center.getStatus().needsSignIn).toBe(false);
  });

  it("sends everything only from the tab that is the sender, but a tab always sends the draft open on its own screen", async () => {
    const other = new FakeElection();
    other.leader = false;
    const center = makeCenter({ election: other });
    await center.start();
    // a draft left unsent in the journal (for example by a tab that was closed) is not sent from a tab that is not the sender
    connectivity.reportFailure();
    const owner = makeCenter();
    await owner.start();
    const left = await openAndEdit(owner, "left-over");
    await settle(300);
    left.release();
    owner.stop();
    online = true;
    connectivity.reportSuccess();
    await center.adoptJournal();
    await settle(2_000);
    expect(server.received).toHaveLength(0);
    expect(center.getStatus().leader).toBe(false);
    // the draft this tab has open is sent from here
    await openAndEdit(center, "o1");
    await settle(2_000);
    expect(server.versions.get("o1")).toBe(1);
    expect(server.versions.get("left-over")).toBeUndefined();
    // when this tab becomes the sender the left-over draft is sent too
    other.set(true);
    await settle(1_000);
    expect(server.versions.get("left-over")).toBe(1);
  });

  it("the person's own Retry is tried even while the connection flag still says offline", async () => {
    online = false;
    connectivity.reportFailure();
    const center = makeCenter();
    await center.start();
    await openAndEdit(center, "o1");
    await settle(300);
    expect(server.received).toHaveLength(0);
    center.retry("o1");
    await settle(500);
    expect(server.versions.get("o1")).toBe(1);
  });

  it("the sending tab picks up a draft another tab left unsent after a while", async () => {
    const center = makeCenter();
    await center.start();
    connectivity.reportFailure();
    const second = makeCenter({ election: Object.assign(new FakeElection(), { leader: false }) });
    await second.start();
    const handle = await openAndEdit(second, "o9");
    await settle(300);
    handle.release();
    second.stop();
    online = true;
    connectivity.reportSuccess();
    await settle(31_000);
    await settle(2_000);
    expect(server.versions.get("o9")).toBe(1);
  });

  it("loads the drafts with unsent changes from the journal at start, in first-changed order", async () => {
    connectivity.reportFailure();
    const first = makeCenter();
    await first.start();
    await openAndEdit(first, "b");
    await settle(300);
    await openAndEdit(first, "a");
    await settle(300);
    first.stop();

    const second = makeCenter();
    await second.start();
    expect(second.getStatus().items.map((i) => i.orderId)).toEqual(["b", "a"]);
    expect(second.getStatus().counts.waiting).toBe(2);
  });

  it("keeps a copy of an order opened from the server so it can be edited offline later", async () => {
    const center = makeCenter();
    await center.start();
    const serverOrder = server.order("o9", 4);
    const handle = await center.openDraft({ orderId: "o9", serverOrder, storeId: "s1", lineInfo: {} });
    const record = await db.get("drafts", "o9");
    expect(record).toMatchObject({ syncState: "synced", baseVersion: 4, neverSent: false });
    expect(center.getStatus().counts.waiting).toBe(0); // an unchanged copy is not a waiting item
    handle.release();
  });

  it("reports a draft that conflicts with the server and stops sending it", async () => {
    server.versions.set("o1", 7);
    const center = makeCenter();
    await center.start();
    const handle = await center.openDraft({ orderId: "o1", serverOrder: server.order("o1", 3), storeId: "s1", lineInfo: {} });
    handle.machine.edit(state("s1", 5));
    await settle(1_000);
    expect(handle.machine.getSnapshot().status).toBe("changed_elsewhere");
    expect(center.getStatus().counts).toMatchObject({ conflict: 1 });
    expect((await db.get("drafts", "o1"))?.syncState).toBe("conflict");
    expect((await db.get("drafts", "o1"))?.state.lines[0]?.quantity).toBe(5); // the phone version is kept
    const sent = server.received.length;
    await settle(20_000);
    expect(server.received.length).toBe(sent);
  });
});
