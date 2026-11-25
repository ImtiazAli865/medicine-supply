import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDeviceStorage } from "../helpers/memory-storage";
import { createConnectivity, type Connectivity } from "@/lib/device/connectivity";
import type { LeaderElection } from "@/lib/device/locks";
import type { BusinessDatabase, PaymentOpRecord } from "@/lib/device/schema";
import { SyncCenter } from "@/lib/device/sync-center";

// Payments recorded on the phone (Module 011, task T008): recorded once, kept across a restart, counted honestly in the status,
// removed only when the rules allow it. Sending them is covered by sync-center-payments-send.test.ts.

const BIZ = "123e4567-e89b-42d3-a456-426614174000";
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const TODAY = "2026-11-24";

const election: LeaderElection = { isLeader: () => true, subscribe: () => () => undefined, stop: () => undefined };

let storage: MemoryDeviceStorage;
let db: BusinessDatabase;
let connectivity: Connectivity;
let counter: number;
const centers: SyncCenter[] = [];

function makeCenter() {
  const center = new SyncCenter({
    db,
    connectivity,
    election,
    transport: async () => ({ kind: "unauthorized" }),
    scheduler: { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    newId: () => `pay-${++counter}`,
    nowText: () => "10:00",
    today: () => TODAY,
    debounceMs: 100,
  });
  centers.push(center);
  return center;
}

const input = (amount: string, extra: { date?: string; reference?: string } = {}) => ({ amount, date: extra.date ?? TODAY, reference: extra.reference ?? "" });

beforeEach(async () => {
  vi.useFakeTimers();
  storage = new MemoryDeviceStorage();
  const r = await storage.openBusiness(BIZ);
  if (!r.ok) throw new Error("open failed");
  db = r.db;
  counter = 0;
  connectivity = createConnectivity({ ping: async () => true });
  connectivity.reportFailure(); // start offline: nothing is sent in these tests
});

afterEach(() => {
  for (const c of centers.splice(0)) c.stop();
  vi.useRealTimers();
});

describe("recording a payment on the phone", () => {
  it("keeps the typed values in the phone's storage, waiting and not attempted, and records nothing else", async () => {
    const center = makeCenter();
    await center.start();
    const result = await center.recordPayment({ storeId: S1, input: input("5000", { reference: " R-1 " }) });
    expect(result.ok).toBe(true);
    const stored = await db.getAll("paymentOps");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ paymentId: "pay-1", storeId: S1, amount: "5000.00", date: TODAY, reference: "R-1", state: "on_device", attempted: false, conflict: null, seq: 1 });
    expect(Object.keys(stored[0]!).sort()).toEqual(
      ["amount", "attempted", "conflict", "date", "nextTryTick", "paymentId", "reason", "recordedOn", "reference", "rev", "seq", "state", "storeId", "tries"].sort(),
    );
  });

  it("refuses the same input the online form refuses, with the same words, and records nothing", async () => {
    const center = makeCenter();
    await center.start();
    const bad = await center.recordPayment({ storeId: S1, input: { amount: "0", date: "2026-11-25", reference: "x".repeat(101) } });
    expect(bad).toEqual({
      ok: false,
      reason: "invalid",
      fields: { amount: "Enter an amount above 0 with at most two decimals.", date: "Choose a date up to today.", reference: "Use at most 100 characters." },
    });
    expect(await db.getAll("paymentOps")).toEqual([]);
    expect(center.getStatus().items).toEqual([]);
  });

  it("never records one key twice", async () => {
    const center = makeCenter();
    await center.start();
    expect((await center.recordPayment({ storeId: S1, input: input("100"), paymentId: "same-key" })).ok).toBe(true);
    const again = await center.recordPayment({ storeId: S1, input: input("100"), paymentId: "same-key" });
    expect(again).toMatchObject({ ok: false, reason: "duplicate" });
    const other = await center.recordPayment({ storeId: S2, input: input("999"), paymentId: "same-key" });
    expect(other).toMatchObject({ ok: false, reason: "duplicate" });
    expect(await db.getAll("paymentOps")).toHaveLength(1);
    expect((await db.get("paymentOps", "same-key"))?.storeId).toBe(S1);
  });

  it("numbers payments in the order recorded, also across tabs of the same phone", async () => {
    const a = makeCenter();
    await a.start();
    await a.recordPayment({ storeId: S1, input: input("1") });
    const b = makeCenter();
    await b.start();
    await b.recordPayment({ storeId: S1, input: input("2") });
    await a.recordPayment({ storeId: S1, input: input("3") });
    expect((await db.getAll("paymentOps")).map((p) => p.seq).sort()).toEqual([1, 2, 3]);
  });

  it("says so and records nothing when the phone cannot keep the payment", async () => {
    const center = makeCenter();
    await center.start();
    storage.failWrites = true;
    const result = await center.recordPayment({ storeId: S1, input: input("100") });
    expect(result).toMatchObject({ ok: false, reason: "storage" });
    expect((result as { message: string }).message).toMatch(/nothing was recorded/i);
    storage.failWrites = false;
    expect(await db.getAll("paymentOps")).toEqual([]);
    expect(center.getStatus().waitingTotal).toEqual({ count: 0, paisa: 0 });
  });
});

describe("the status of waiting payments", () => {
  it("counts them as waiting items and adds them exactly, overall and for each store", async () => {
    const center = makeCenter();
    await center.start();
    await center.recordPayment({ storeId: S1, input: input("0.10") });
    await center.recordPayment({ storeId: S1, input: input("0.20") });
    await center.recordPayment({ storeId: S2, input: input("5000") });
    const status = center.getStatus();
    expect(status.items.map((i) => i.kind)).toEqual(["payment", "payment", "payment"]);
    expect(status.counts.waiting).toBe(3);
    expect(status.payments).toEqual({ waiting: 3, syncing: 0, conflict: 0 });
    expect(status.waitingTotal).toEqual({ count: 3, paisa: 500_030 });
    expect(status.waitingByStore[S1]).toEqual({ count: 2, paisa: 30 });
    expect(status.waitingByStore[S2]).toEqual({ count: 1, paisa: 500_000 });
    expect(status.items[0]).toMatchObject({ kind: "payment", orderId: "pay-1", storeId: S1, state: "waiting", neverSent: true, payment: { amount: "0.10", canRemove: true, conflict: null } });
  });

  it("tells the screens when it changes and lists a copy the screens cannot damage", async () => {
    const center = makeCenter();
    await center.start();
    const seen: number[] = [];
    center.subscribe(() => seen.push(center.getStatus().waitingTotal.count));
    await center.recordPayment({ storeId: S1, input: input("10") });
    expect(seen).toContain(1);
    const list = center.listPayments();
    list[0]!.amount = "999999.00";
    expect(center.listPayments()[0]!.amount).toBe("10.00");
  });

  it("keeps order and store items as they were", async () => {
    const center = makeCenter();
    await center.start();
    await center.createStore({ name: "New Store" });
    await center.recordPayment({ storeId: S1, input: input("10") });
    const kinds = center.getStatus().items.map((i) => i.kind);
    expect(kinds).toEqual(["store", "payment"]);
    expect(center.getStatus().items[0]!.payment).toBeNull();
  });
});

describe("after the app closes and opens again", () => {
  it("finds all three payments once, in the same order, with nothing changed", async () => {
    const first = makeCenter();
    await first.start();
    await first.recordPayment({ storeId: S1, input: input("100") });
    await first.recordPayment({ storeId: S2, input: input("200") });
    await first.recordPayment({ storeId: S1, input: input("300", { reference: "R-3" }) });
    first.stop();

    const second = makeCenter();
    await second.start();
    const list = second.listPayments();
    expect(list.map((p) => [p.paymentId, p.storeId, p.amount, p.reference])).toEqual([
      ["pay-1", S1, "100.00", null],
      ["pay-2", S2, "200.00", null],
      ["pay-3", S1, "300.00", "R-3"],
    ]);
    expect(second.getStatus().waitingTotal).toEqual({ count: 3, paisa: 60_000 });
    expect(await db.getAll("paymentOps")).toHaveLength(3);
  });

  it("brings a payment that was sending when the app closed back as waiting and still attempted", async () => {
    const stuck: PaymentOpRecord = {
      paymentId: "p-stuck",
      rev: 3,
      seq: 1,
      storeId: S1,
      amount: "700.00",
      date: TODAY,
      reference: null,
      state: "syncing",
      reason: null,
      conflict: null,
      attempted: true,
      tries: 1,
      nextTryTick: 0,
      recordedOn: "09:00",
    };
    await db.put("paymentOps", stuck);
    const center = makeCenter();
    await center.start();
    const [p] = center.listPayments();
    expect(p).toMatchObject({ paymentId: "p-stuck", state: "waiting", attempted: true });
    expect(center.getStatus().payments).toEqual({ waiting: 1, syncing: 0, conflict: 0 });
    expect(center.getStatus().items[0]!.payment?.canRemove).toBe(false);
  });

  it("keeps a business's payments away from another business", async () => {
    const other = await storage.openBusiness("123e4567-e89b-42d3-a456-426614174001");
    if (!other.ok) throw new Error("open failed");
    await other.db.put("paymentOps", { ...(await seedPayment()), paymentId: "other-biz" });
    const center = makeCenter();
    await center.start();
    expect(center.listPayments()).toEqual([]);
  });
});

async function seedPayment(): Promise<PaymentOpRecord> {
  return {
    paymentId: "seed",
    rev: 1,
    seq: 1,
    storeId: S1,
    amount: "1.00",
    date: TODAY,
    reference: null,
    state: "on_device",
    reason: null,
    conflict: null,
    attempted: false,
    tries: 0,
    nextTryTick: 0,
    recordedOn: "t",
  };
}

describe("removing a waiting payment", () => {
  it("removes a payment that was never sent, from memory and from the storage", async () => {
    const center = makeCenter();
    await center.start();
    await center.recordPayment({ storeId: S1, input: input("100") });
    expect(await center.removePayment("pay-1")).toBe(true);
    expect(await db.getAll("paymentOps")).toEqual([]);
    expect(center.getStatus().waitingTotal).toEqual({ count: 0, paisa: 0 });
    expect(center.getStatus().items).toEqual([]);
  });

  it("refuses to remove a payment that was sent and has no answer", async () => {
    await db.put("paymentOps", { ...(await seedPayment()), paymentId: "sent", state: "waiting", attempted: true });
    const center = makeCenter();
    await center.start();
    expect(await center.removePayment("sent")).toBe(false);
    expect(await db.get("paymentOps", "sent")).toBeDefined();
    expect(center.listPayments()).toHaveLength(1);
  });

  it("removes a payment in conflict", async () => {
    await db.put("paymentOps", { ...(await seedPayment()), paymentId: "c1", state: "conflict", conflict: "not_found", attempted: true, reason: "This store is not on the server." });
    const center = makeCenter();
    await center.start();
    expect(center.getStatus().payments).toEqual({ waiting: 0, syncing: 0, conflict: 1 });
    expect(center.getStatus().counts.conflict).toBe(1);
    expect(await center.removePayment("c1")).toBe(true);
    expect(await db.getAll("paymentOps")).toEqual([]);
  });

  it("answers false for a payment it does not know", async () => {
    const center = makeCenter();
    await center.start();
    expect(await center.removePayment("nope")).toBe(false);
  });

  it("keeps the payment when the storage refuses the removal, and a reload does not lose it either", async () => {
    const center = makeCenter();
    await center.start();
    await center.recordPayment({ storeId: S1, input: input("100") });
    storage.failWrites = true;
    expect(await center.removePayment("pay-1")).toBe(false);
    storage.failWrites = false;
    expect(center.listPayments()).toHaveLength(1);
    expect(await db.getAll("paymentOps")).toHaveLength(1);
  });
});
