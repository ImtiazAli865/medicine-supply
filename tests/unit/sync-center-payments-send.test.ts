import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDeviceStorage } from "../helpers/memory-storage";
import { createConnectivity, type Connectivity } from "@/lib/device/connectivity";
import type { LeaderElection } from "@/lib/device/locks";
import type { BusinessDatabase, StoreOpPayload } from "@/lib/device/schema";
import { SyncCenter, type StoreSendResult } from "@/lib/device/sync-center";
import { FakeLeader, FakeLedger } from "../helpers/payment-harness";

// Sending waiting payments (Module 011, US2): once each, in order, with the same key on every retry, held for a store that is
// still waiting, never from a tab that is not the sender, and kept (never dropped) on every refusal.

const BIZ = "123e4567-e89b-42d3-a456-426614174000";
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const TODAY = "2026-11-24";

let storage: MemoryDeviceStorage;
let db: BusinessDatabase;
let connectivity: Connectivity;
let ledger: FakeLedger;
let counter: number;
let storeTransportCalls: string[];
let storeScript: Array<"ok" | "similar">;
const centers: SyncCenter[] = [];

function makeCenter(election: LeaderElection = new FakeLeader(true)) {
  const center = new SyncCenter({
    db,
    connectivity,
    election,
    transport: async () => ({ kind: "unauthorized" }),
    storeTransport: async (payload: StoreOpPayload, confirm: boolean): Promise<StoreSendResult> => {
      storeTransportCalls.push(payload.name);
      const step = storeScript.shift() ?? "ok";
      if (step === "similar" && !confirm) return { kind: "similar", matches: [{ id: S2, name: "Existing Pharmacy" }] };
      return { kind: "ok" };
    },
    paymentTransport: (op) => ledger.send(op),
    scheduler: { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    newId: () => `pay-${++counter}`,
    nowText: () => "10:00",
    today: () => TODAY,
    debounceMs: 100,
  });
  centers.push(center);
  return center;
}

const input = (amount: string) => ({ amount, date: TODAY, reference: "" });
const settle = (ms = 100) => vi.advanceTimersByTimeAsync(ms);
const goOnline = () => connectivity.reportSuccess();

beforeEach(async () => {
  vi.useFakeTimers();
  storage = new MemoryDeviceStorage();
  const r = await storage.openBusiness(BIZ);
  if (!r.ok) throw new Error("open failed");
  db = r.db;
  ledger = new FakeLedger();
  counter = 0;
  storeTransportCalls = [];
  storeScript = [];
  connectivity = createConnectivity({ ping: async () => false }, "offline");
});

afterEach(() => {
  for (const c of centers.splice(0)) c.stop();
  vi.useRealTimers();
});

describe("sending waiting payments", () => {
  it("sends three payments one at a time in the order recorded and removes each once the server confirms it", async () => {
    const center = makeCenter();
    await center.start();
    await center.recordPayment({ storeId: S1, input: input("100") });
    await center.recordPayment({ storeId: S1, input: input("200") });
    await center.recordPayment({ storeId: S2, input: input("300") });
    await settle();
    expect(ledger.calls).toEqual([]); // offline: nothing is sent
    expect(center.getStatus().payments.waiting).toBe(3);
    goOnline();
    await settle();
    expect(ledger.calls.map((c) => [c.id, c.storeId, c.amount])).toEqual([
      ["pay-1", S1, "100.00"],
      ["pay-2", S1, "200.00"],
      ["pay-3", S2, "300.00"],
    ]);
    expect(ledger.maxInFlight).toBe(1);
    expect(ledger.entries.size).toBe(3);
    expect(await db.getAll("paymentOps")).toEqual([]);
    expect(center.getStatus().items).toEqual([]);
    expect(center.getStatus().waitingTotal).toEqual({ count: 0, paisa: 0 });
    expect(center.getStatus().lastSyncAt).not.toBeNull();
  });

  it("writes the attempt to the phone before the request goes out, and shows the payment as sending while it is out", async () => {
    const center = makeCenter();
    await center.start();
    await center.recordPayment({ storeId: S1, input: input("100") });
    let release!: () => void;
    ledger.gate = new Promise<void>((resolve) => (release = resolve));
    goOnline();
    await settle(10);
    expect(ledger.calls).toHaveLength(1);
    expect(center.getStatus().payments).toEqual({ waiting: 0, syncing: 1, conflict: 0 });
    expect(center.getStatus().items[0]).toMatchObject({ state: "syncing", payment: { canRemove: false } });
    expect(await db.get("paymentOps", "pay-1")).toMatchObject({ attempted: true, state: "syncing" });
    expect(await center.removePayment("pay-1")).toBe(false);
    release();
    await settle();
    expect(await db.getAll("paymentOps")).toEqual([]);
  });

  it("does not send an attempt it could not write to the phone, and tries again later", async () => {
    const center = makeCenter();
    await center.start();
    await center.recordPayment({ storeId: S1, input: input("100") });
    storage.failWrites = true;
    goOnline();
    await settle(10);
    expect(ledger.calls).toEqual([]);
    expect(center.getStatus().payments.waiting).toBe(1);
    storage.failWrites = false;
    await settle(3_000);
    expect(ledger.calls.map((c) => c.id)).toEqual(["pay-1"]);
    expect(ledger.entries.size).toBe(1);
  });

  it("sends the same key again when the answer was lost, and the replay removes it with one entry on the server", async () => {
    const center = makeCenter();
    await center.start();
    await center.recordPayment({ storeId: S1, input: input("100") });
    ledger.script = ["lose"];
    goOnline();
    await settle(10);
    expect(ledger.entries.size).toBe(1); // the server recorded it
    expect(center.getStatus().payments.waiting).toBe(1); // but the phone has no answer yet
    expect((await db.get("paymentOps", "pay-1"))?.attempted).toBe(true);
    await settle(2_100);
    expect(ledger.calls.map((c) => c.id)).toEqual(["pay-1", "pay-1"]);
    expect(ledger.entries.size).toBe(1);
    expect(await db.getAll("paymentOps")).toEqual([]);
  });

  it("resends the same key after the app closed between the attempt and the answer", async () => {
    const first = makeCenter();
    await first.start();
    await first.recordPayment({ storeId: S1, input: input("100") });
    ledger.script = ["hang"];
    goOnline();
    await settle(10);
    expect(await db.get("paymentOps", "pay-1")).toMatchObject({ attempted: true, state: "syncing" });
    first.stop();

    const second = makeCenter();
    await second.start();
    expect(second.listPayments()[0]).toMatchObject({ paymentId: "pay-1", attempted: true, state: "waiting" });
    await settle(10);
    expect(ledger.calls.map((c) => c.id)).toEqual(["pay-1", "pay-1"]);
    expect(ledger.entries.size).toBe(1);
    expect(await db.getAll("paymentOps")).toEqual([]);
  });

  it("sends nothing from a tab that is not the sender, and exactly one tab sends when the role moves", async () => {
    const a = new FakeLeader(false);
    const b = new FakeLeader(false);
    const centerA = makeCenter(a);
    const centerB = makeCenter(b);
    await centerA.start();
    await centerB.start();
    await centerA.recordPayment({ storeId: S1, input: input("100") });
    await centerB.recordPayment({ storeId: S1, input: input("200") });
    goOnline();
    await settle(50);
    expect(ledger.calls).toEqual([]);
    a.set(true);
    await settle(50);
    expect(ledger.calls.map((c) => c.id).sort()).toEqual(["pay-1", "pay-2"]);
    expect(ledger.entries.size).toBe(2);
    // the sending role moves to the other tab: it finds nothing left to send and sends nothing again
    a.set(false);
    b.set(true);
    await settle(50);
    expect(ledger.calls).toHaveLength(2);
    expect(await db.getAll("paymentOps")).toEqual([]);
  });

  it("waits 2 s, 5 s, 15 s, 45 s and then 2 minutes between tries of a payment the server cannot answer", async () => {
    const center = makeCenter();
    await center.start();
    await center.recordPayment({ storeId: S1, input: input("100") });
    ledger.script = ["5xx", "5xx", "5xx", "5xx", "5xx", "5xx"];
    const t0 = Date.now();
    const at: number[] = [];
    const realSend = ledger.send.bind(ledger);
    ledger.send = async (op) => {
      at.push(Date.now() - t0);
      return realSend(op);
    };
    goOnline();
    await settle(10);
    expect(at).toEqual([0]);
    for (const wait of [2_000, 5_000, 15_000, 45_000, 120_000]) {
      const lastCall = at[at.length - 1]!;
      const calls = at.length;
      await vi.advanceTimersByTimeAsync(lastCall + wait - 1 - (Date.now() - t0));
      expect(at.length, `still waiting ${wait - 1} ms after the last try`).toBe(calls);
      await vi.advanceTimersByTimeAsync(1);
      expect(at.length, `tried again after ${wait} ms`).toBe(calls + 1);
    }
    expect(at.slice(1).map((time, i) => time - at[i]!)).toEqual([2_000, 5_000, 15_000, 45_000, 120_000]);
    expect(new Set(ledger.calls.map((c) => c.id))).toEqual(new Set(["pay-1"]));
  });

  it("holds the later payments of the same store while one waits for its retry, and never another store's payment", async () => {
    const center = makeCenter();
    await center.start();
    await center.recordPayment({ storeId: S1, input: input("100") });
    await center.recordPayment({ storeId: S1, input: input("200") });
    await center.recordPayment({ storeId: S2, input: input("300") });
    ledger.script = ["5xx"]; // the first call (the first payment of S1) fails
    goOnline();
    await settle(10);
    expect(ledger.calls.map((c) => c.id)).toEqual(["pay-1", "pay-3"]); // S1's second payment waits, S2 goes through
    await settle(2_100);
    expect(ledger.calls.map((c) => c.id)).toEqual(["pay-1", "pay-3", "pay-1", "pay-2"]);
    expect(await db.getAll("paymentOps")).toEqual([]);
    expect(ledger.entries.size).toBe(3);
  });

  it("keeps every payment and sends none while sending is paused, and sends them when it resumes", async () => {
    const center = makeCenter();
    await center.start();
    await center.pause();
    await center.recordPayment({ storeId: S1, input: input("100") });
    goOnline();
    await settle(2_000);
    expect(ledger.calls).toEqual([]);
    expect(center.getStatus().paused).toBe(true);
    await center.resume();
    await settle(50);
    expect(ledger.calls.map((c) => c.id)).toEqual(["pay-1"]);
  });

  it("keeps every payment and stops sending after a 401, and sends again after signing in", async () => {
    const center = makeCenter();
    await center.start();
    await center.recordPayment({ storeId: S1, input: input("100") });
    await center.recordPayment({ storeId: S2, input: input("200") });
    ledger.script = ["401"];
    goOnline();
    await settle(50);
    expect(ledger.calls).toHaveLength(1);
    expect(center.getStatus().needsSignIn).toBe(true);
    expect(center.getStatus().payments.waiting).toBe(2);
    expect((await db.getAll("paymentOps")).length).toBe(2);
    await settle(5_000);
    expect(ledger.calls).toHaveLength(1);
    center.signedIn();
    await settle(50);
    expect(ledger.entries.size).toBe(2);
    expect(await db.getAll("paymentOps")).toEqual([]);
  });

  it("does not send a payment for a store that is still waiting on the phone until the store exists, and sends it right after", async () => {
    const center = makeCenter();
    await center.start();
    const store = await center.createStore({ name: "New Offline Store" });
    await center.recordPayment({ storeId: store!.id, input: input("100") });
    await center.recordPayment({ storeId: S2, input: input("50") });
    goOnline();
    await settle(50);
    expect(storeTransportCalls).toEqual(["New Offline Store"]);
    expect(ledger.calls.map((c) => [c.id, c.storeId])).toEqual([
      ["pay-2", store!.id],
      ["pay-3", S2],
    ].map(([id, s]) => [id, s]));
    expect(ledger.entries.size).toBe(2);
    expect(await db.getAll("paymentOps")).toEqual([]);
  });

  it("holds the payment of a store whose creation is not answered yet", async () => {
    const center = makeCenter();
    await center.start();
    const store = await center.createStore({ name: "Slow Store" });
    await center.recordPayment({ storeId: store!.id, input: input("100") });
    storeScript = ["similar"];
    goOnline();
    await settle(50);
    // the server found a similar store: the supplier must answer, and the payment waits for that answer
    expect(center.getStatus().pendingStoreIds).toEqual([store!.id]);
    expect(ledger.calls).toEqual([]);
    expect(await db.getAll("paymentOps")).toHaveLength(1);
  });

  it("moves the waiting payments to the existing store in one step with the store's removal when the supplier uses the existing store", async () => {
    const center = makeCenter();
    await center.start();
    const store = await center.createStore({ name: "Existing Pharmacy" });
    await center.recordPayment({ storeId: store!.id, input: input("100") });
    await center.recordPayment({ storeId: S1, input: input("70") });
    storeScript = ["similar"];
    goOnline();
    await settle(50);
    expect(ledger.calls.map((c) => c.id)).toEqual(["pay-3"]); // only the payment of the other store went
    expect(await center.resolveSimilar(store!.id, { choice: "use_existing", existingId: S2 })).toBe(true);
    await settle(50);
    expect(ledger.calls.map((c) => [c.id, c.storeId])).toEqual([
      ["pay-3", S1],
      ["pay-2", S2],
    ]);
    expect(await db.get("storeOps", store!.id)).toBeUndefined();
    expect(await db.get("stores", store!.id)).toBeUndefined();
    expect(await db.getAll("paymentOps")).toEqual([]);
  });

  it("remaps the stored payments together with the removal of the store", async () => {
    const center = makeCenter();
    await center.start();
    const store = await center.createStore({ name: "Existing Pharmacy" });
    await center.recordPayment({ storeId: store!.id, input: input("100") });
    storeScript = ["similar"];
    goOnline();
    await settle(50);
    // make the answer's writes visible: after the remap the stored payment belongs to the existing store
    storage.failAfterWrites = null;
    expect(await center.resolveSimilar(store!.id, { choice: "use_existing", existingId: S2 })).toBe(true);
    expect((await db.get("paymentOps", "pay-2"))?.storeId).toBe(S2);
    expect(await db.get("storeOps", store!.id)).toBeUndefined();
  });

  it("counts a send as a successful sync for the status screens", async () => {
    const center = makeCenter();
    await center.start();
    expect(center.getStatus().lastSyncAt).toBeNull();
    await center.recordPayment({ storeId: S1, input: input("100") });
    goOnline();
    await settle(50);
    expect(center.getStatus().lastSyncAt).toBe("10:00");
    expect(await db.get("meta", "lastSyncAt")).toMatchObject({ value: "10:00" });
  });
});
