import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDeviceStorage } from "../helpers/memory-storage";
import { FakeLeader, FakeLedger } from "../helpers/payment-harness";
import { createConnectivity, type Connectivity } from "@/lib/device/connectivity";
import type { BusinessDatabase } from "@/lib/device/schema";
import { SyncCenter } from "@/lib/device/sync-center";

// What happens when the server refuses a waiting payment (Module 011, US2): it is never dropped, never retried by itself, never
// changes another payment, and the supplier decides (keep it, remove it after a confirmation, or correct a refused detail).

const BIZ = "123e4567-e89b-42d3-a456-426614174000";
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const TODAY = "2026-11-24";

let storage: MemoryDeviceStorage;
let db: BusinessDatabase;
let connectivity: Connectivity;
let ledger: FakeLedger;
let counter: number;
const centers: SyncCenter[] = [];

function makeCenter() {
  const center = new SyncCenter({
    db,
    connectivity,
    election: new FakeLeader(true),
    transport: async () => ({ kind: "unauthorized" }),
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

const input = (amount: string, date = TODAY) => ({ amount, date, reference: "" });
const settle = (ms = 100) => vi.advanceTimersByTimeAsync(ms);

beforeEach(async () => {
  vi.useFakeTimers();
  storage = new MemoryDeviceStorage();
  const r = await storage.openBusiness(BIZ);
  if (!r.ok) throw new Error("open failed");
  db = r.db;
  ledger = new FakeLedger();
  counter = 0;
  connectivity = createConnectivity({ ping: async () => false }, "online");
});

afterEach(() => {
  for (const c of centers.splice(0)) c.stop();
  vi.useRealTimers();
});

describe("a refused payment is kept, shown with its reason and not retried by itself", () => {
  it("keeps a payment for a store the server does not know, with the reason, and does not try it again", async () => {
    const center = makeCenter();
    await center.start();
    ledger.script = ["not_found"];
    await center.recordPayment({ storeId: S1, input: input("100") });
    await settle();
    expect(ledger.calls).toHaveLength(1);
    const [item] = center.getStatus().items;
    expect(item).toMatchObject({ kind: "payment", state: "conflict", reason: "This store is not on the server.", payment: { conflict: "not_found", canRemove: true } });
    expect(center.getStatus().counts.conflict).toBe(1);
    expect(center.getStatus().payments).toEqual({ waiting: 0, syncing: 0, conflict: 1 });
    expect(await db.get("paymentOps", "pay-1")).toMatchObject({ state: "conflict", conflict: "not_found", attempted: true });
    await settle(10 * 60_000);
    expect(ledger.calls).toHaveLength(1);
    expect(ledger.entries.size).toBe(0);
  });

  it("keeps a payment whose key holds other details, with the reason, and offers no correction", async () => {
    const center = makeCenter();
    await center.start();
    ledger.script = ["request_reused"];
    await center.recordPayment({ storeId: S1, input: input("100") });
    await settle();
    expect(center.getStatus().items[0]).toMatchObject({ state: "conflict", reason: "A payment with this key but other details already exists. Check the store's account.", payment: { conflict: "request_reused" } });
    expect(await center.correctAndResend("pay-1", input("120"))).toEqual({ ok: false, message: "This payment cannot be corrected here." });
    expect(ledger.calls).toHaveLength(1);
    expect((await db.get("paymentOps", "pay-1"))?.amount).toBe("100.00");
  });

  it("keeps a payment the server refused for its details, and corrects and sends it again with the same key", async () => {
    const center = makeCenter();
    await center.start();
    ledger.script = ["refused"];
    await center.recordPayment({ storeId: S1, input: { amount: "100", date: "2026-11-20", reference: "R1" } });
    await settle();
    expect(center.getStatus().items[0]).toMatchObject({ state: "conflict", reason: "Choose a date up to today.", payment: { conflict: "refused" } });
    // a correction the phone refuses itself changes nothing
    expect(await center.correctAndResend("pay-1", { amount: "0", date: TODAY, reference: "R1" })).toMatchObject({ ok: false, fields: { amount: "Enter an amount above 0 with at most two decimals." } });
    expect(center.getStatus().items[0]!.state).toBe("conflict");
    expect(ledger.calls).toHaveLength(1);
    // a valid correction is sent again at once, with the same key, and recorded once
    expect(await center.correctAndResend("pay-1", { amount: "100.5", date: TODAY, reference: "R1 fixed" })).toEqual({ ok: true });
    await settle();
    expect(ledger.calls.map((c) => [c.id, c.storeId, c.amount])).toEqual([
      ["pay-1", S1, "100.00"],
      ["pay-1", S1, "100.50"],
    ]);
    expect([...ledger.entries.entries()]).toEqual([["pay-1", { storeId: S1, amount: "100.50", date: TODAY, reference: "R1 fixed" }]]);
    expect(await db.getAll("paymentOps")).toEqual([]);
  });

  it("does not correct a payment that is not in conflict or not known", async () => {
    const center = makeCenter();
    await center.start();
    expect(await center.correctAndResend("nope", input("1"))).toMatchObject({ ok: false });
    await center.pause();
    await center.recordPayment({ storeId: S1, input: input("100") });
    expect(await center.correctAndResend("pay-1", input("120"))).toMatchObject({ ok: false });
  });
});

describe("the supplier's choices", () => {
  it("keeps a payment in conflict for later: nothing is sent until the supplier chooses Retry for that payment", async () => {
    const center = makeCenter();
    await center.start();
    ledger.script = ["not_found"];
    await center.recordPayment({ storeId: S1, input: input("100") });
    await settle();
    center.retry(); // the blanket Retry hurries waiting payments only, never a payment that needs a decision
    await settle(60_000);
    expect(ledger.calls).toHaveLength(1);
    expect(center.getStatus().items[0]!.state).toBe("conflict");
    // the store came back on the server: the supplier chooses to try this payment again
    center.retry("pay-1");
    await settle();
    expect(ledger.calls.map((c) => c.id)).toEqual(["pay-1", "pay-1"]);
    expect(ledger.entries.size).toBe(1);
    expect(await db.getAll("paymentOps")).toEqual([]);
  });

  it("keeps a conflict across a restart and does not send it on start", async () => {
    const first = makeCenter();
    await first.start();
    ledger.script = ["not_found"];
    await first.recordPayment({ storeId: S1, input: input("100") });
    await settle();
    first.stop();
    const second = makeCenter();
    await second.start();
    await settle(60_000);
    expect(ledger.calls).toHaveLength(1);
    expect(second.getStatus().items[0]).toMatchObject({ state: "conflict", reason: "This store is not on the server.", payment: { conflict: "not_found" } });
  });

  it("removes a payment in conflict only when asked, and removes nothing else", async () => {
    const center = makeCenter();
    await center.start();
    ledger.script = ["not_found", "ok"];
    await center.recordPayment({ storeId: S1, input: input("100") });
    await center.recordPayment({ storeId: S2, input: input("200") });
    await settle();
    expect(center.getStatus().payments.conflict).toBe(1);
    expect(await center.removePayment("pay-1")).toBe(true);
    expect(await db.getAll("paymentOps")).toEqual([]); // pay-2 was sent and confirmed on its own
    expect(ledger.entries.has("pay-2")).toBe(true);
    expect(ledger.entries.has("pay-1")).toBe(false);
  });

  it("refuses to remove a payment that is waiting for an answer, also when the supplier asks", async () => {
    const center = makeCenter();
    await center.start();
    ledger.script = ["5xx"];
    await center.recordPayment({ storeId: S1, input: input("100") });
    await settle(10);
    expect(center.getStatus().items[0]).toMatchObject({ state: "waiting", payment: { canRemove: false } });
    expect(await center.removePayment("pay-1")).toBe(false);
    expect(await db.getAll("paymentOps")).toHaveLength(1);
  });
});

describe("one payment's refusal never touches another payment", () => {
  it("does not hold back or change the later payments of the same store or the payments of other stores", async () => {
    const center = makeCenter();
    await center.start();
    ledger.script = ["refused"]; // the first payment is refused, the next ones are fine
    await center.recordPayment({ storeId: S1, input: input("100") });
    await center.recordPayment({ storeId: S1, input: input("200") });
    await center.recordPayment({ storeId: S2, input: input("300") });
    await settle();
    expect(ledger.calls.map((c) => c.id)).toEqual(["pay-1", "pay-2", "pay-3"]);
    expect([...ledger.entries.keys()].sort()).toEqual(["pay-2", "pay-3"]);
    expect(await db.getAll("paymentOps")).toHaveLength(1);
    expect(await db.get("paymentOps", "pay-1")).toMatchObject({ state: "conflict", amount: "100.00", storeId: S1 });
  });

  it("only ever sends a payment with its own key to its own store", async () => {
    const center = makeCenter();
    await center.start();
    const recorded: Array<[string, string, string]> = [];
    for (const [store, amount] of [[S1, "10"], [S2, "20"], [S1, "30"], [S2, "40"]] as const) {
      const result = await center.recordPayment({ storeId: store, input: input(amount) });
      if (result.ok) recorded.push([result.payment.paymentId, result.payment.storeId, result.payment.amount]);
    }
    ledger.script = ["5xx", "lose", "not_found"];
    await settle(5 * 60_000);
    for (const call of ledger.calls) expect(recorded).toContainEqual([call.id, call.storeId, call.amount]);
    expect(new Set(ledger.calls.map((c) => c.id)).size).toBeLessThanOrEqual(4);
  });
});
