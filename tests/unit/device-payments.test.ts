import { describe, expect, it } from "vitest";
import {
  canRemove,
  conflictFromAnswer,
  dueNow,
  formatWaiting,
  isHeldForStore,
  newPaymentOp,
  nextDue,
  nextSeq,
  remapStore,
  sendOrder,
  waitingTotals,
} from "@/lib/device/payments";
import type { PaymentOpRecord } from "@/lib/device/schema";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const NONE = new Set<string>();

function op(paymentId: string, seq: number, storeId = S1, extra: Partial<PaymentOpRecord> = {}): PaymentOpRecord {
  return { ...newPaymentOp({ paymentId, storeId, input: { amount: "5000.00", date: "2026-11-24", reference: null }, seq, recordedOn: "10:00" }), ...extra };
}

const ctx = (pending: string[] = [], retrying: string[] = []) => ({ pendingStoreIds: new Set(pending), retryingIds: new Set(retrying) });

describe("a new waiting payment", () => {
  it("starts on the device, never attempted, with the typed values and nothing else", () => {
    const p = newPaymentOp({ paymentId: "p1", storeId: S1, input: { amount: "5000.00", date: "2026-11-24", reference: "R-1" }, seq: 3, recordedOn: "10:00" });
    expect(p).toEqual({
      paymentId: "p1",
      rev: 1,
      seq: 3,
      storeId: S1,
      amount: "5000.00",
      date: "2026-11-24",
      reference: "R-1",
      state: "on_device",
      reason: null,
      conflict: null,
      attempted: false,
      tries: 0,
      nextTryTick: 0,
      recordedOn: "10:00",
    });
  });

  it("numbers the payments 1, 2, 3 in the order recorded, also after a removal", () => {
    expect(nextSeq([])).toBe(1);
    expect(nextSeq([op("a", 1), op("b", 2)])).toBe(3);
    expect(nextSeq([op("b", 2), op("c", 5)])).toBe(6);
  });
});

describe("the order of sending", () => {
  it("sorts by seq and does not change the input", () => {
    const ops = [op("c", 3), op("a", 1), op("b", 2)];
    expect(sendOrder(ops).map((o) => o.paymentId)).toEqual(["a", "b", "c"]);
    expect(ops.map((o) => o.paymentId)).toEqual(["c", "a", "b"]);
  });

  it("sends the first payment of each store, one store's payment never waits for another store's", () => {
    const ops = [op("a", 1, S1), op("b", 2, S1), op("c", 3, S2), op("d", 4, S2)];
    expect(dueNow(ops, ctx()).map((o) => o.paymentId)).toEqual(["a", "c"]);
    expect(nextDue(ops, ctx())?.paymentId).toBe("a");
  });

  it("holds the later payments of a store while its earlier payment is sending or waiting for its retry, and only that store", () => {
    const ops = [op("a", 1, S1, { state: "syncing", attempted: true }), op("b", 2, S1), op("c", 3, S2)];
    expect(dueNow(ops, ctx()).map((o) => o.paymentId)).toEqual(["c"]);
    const retry = [op("a", 1, S1, { state: "waiting", attempted: true }), op("b", 2, S1), op("c", 3, S2)];
    expect(dueNow(retry, ctx([], ["a"])).map((o) => o.paymentId)).toEqual(["c"]);
    // when the retry is due, the earlier payment goes first and the later one still waits
    expect(dueNow(retry, ctx()).map((o) => o.paymentId)).toEqual(["a", "c"]);
  });

  it("holds every payment of a store that is still waiting on the phone", () => {
    const ops = [op("a", 1, S1), op("b", 2, S1), op("c", 3, S2)];
    expect(dueNow(ops, ctx([S1])).map((o) => o.paymentId)).toEqual(["c"]);
    expect(isHeldForStore(ops[0]!, new Set([S1]))).toBe(true);
    expect(isHeldForStore(ops[2]!, new Set([S1]))).toBe(false);
    expect(isHeldForStore(ops[0]!, NONE)).toBe(false);
  });

  it("never sends a payment in conflict by itself and does not let it hold anything back", () => {
    const ops = [op("a", 1, S1, { state: "conflict", conflict: "refused", attempted: true }), op("b", 2, S1)];
    expect(dueNow(ops, ctx()).map((o) => o.paymentId)).toEqual(["b"]);
    expect(dueNow([ops[0]!], ctx())).toEqual([]);
    expect(nextDue([], ctx())).toBeNull();
  });

  it("sends 30 payments of one store one at a time, in the order recorded", () => {
    const ops = Array.from({ length: 30 }, (_, i) => op(`p${i}`, 30 - i)); // stored in reverse
    expect(dueNow(ops, ctx())).toHaveLength(1);
    expect(nextDue(ops, ctx())?.paymentId).toBe("p29"); // seq 1
  });
});

describe("removing a payment from the phone", () => {
  it("allows it for a payment never sent and for a payment in conflict", () => {
    expect(canRemove(op("a", 1))).toBe(true);
    expect(canRemove(op("a", 1, S1, { state: "conflict", conflict: "not_found", attempted: true }))).toBe(true);
  });

  it("refuses it for a payment that was sent (or may have been) and has no answer", () => {
    expect(canRemove(op("a", 1, S1, { state: "syncing", attempted: true }))).toBe(false);
    expect(canRemove(op("a", 1, S1, { state: "waiting", attempted: true }))).toBe(false);
    expect(canRemove(op("a", 1, S1, { state: "on_device", attempted: true }))).toBe(false);
  });

  it("allows it for a payment that waits but was never attempted", () => {
    expect(canRemove(op("a", 1, S1, { state: "waiting", attempted: false }))).toBe(true);
  });
});

describe("moving payments to another store", () => {
  it("changes only the payments of the old store and leaves the others as the same objects", () => {
    const ops = [op("a", 1, S1), op("b", 2, S2), op("c", 3, S1)];
    const out = remapStore(ops, S1, "33333333-3333-4333-8333-333333333333");
    expect(out.map((o) => o.storeId)).toEqual(["33333333-3333-4333-8333-333333333333", S2, "33333333-3333-4333-8333-333333333333"]);
    expect(out[1]).toBe(ops[1]);
    expect(ops[0]!.storeId).toBe(S1);
    expect(out[0]!.paymentId).toBe("a");
    expect(out[0]!.amount).toBe("5000.00");
  });

  it("changes nothing when no payment belongs to the old store", () => {
    const ops = [op("a", 1, S2)];
    expect(remapStore(ops, S1, S2)[0]).toBe(ops[0]);
  });
});

describe("the waiting total", () => {
  const amounts = (...list: string[]) => list.map((amount, i) => op(`p${i}`, i + 1, S1, { amount }));

  it("adds exactly in paisa: 0.10 and 0.20 make 0.30", () => {
    const t = waitingTotals(amounts("0.10", "0.20"));
    expect(t.paisa).toBe(30);
    expect(t.count).toBe(2);
    expect(formatWaiting(t)).toBe("2 payments waiting on this phone, PKR 0.30, not counted yet");
  });

  it("totals overall and for each store", () => {
    const ops = [op("a", 1, S1, { amount: "5000.00" }), op("b", 2, S1, { amount: "2500.50" }), op("c", 3, S2, { amount: "100.00" })];
    const t = waitingTotals(ops);
    expect(t.count).toBe(3);
    expect(t.paisa).toBe(760_050);
    expect(t.byStore[S1]).toEqual({ count: 2, paisa: 750_050 });
    expect(t.byStore[S2]).toEqual({ count: 1, paisa: 10_000 });
    expect(formatWaiting(t.byStore[S1]!)).toBe("2 payments waiting on this phone, PKR 7,500.50, not counted yet");
  });

  it("says one payment in the singular and nothing waiting as such", () => {
    expect(formatWaiting(waitingTotals([op("a", 1)]))).toBe("1 payment waiting on this phone, PKR 5,000.00, not counted yet");
    expect(waitingTotals([])).toEqual({ count: 0, paisa: 0, byStore: {} });
    expect(formatWaiting(waitingTotals([]))).toBe("No payments waiting on this phone.");
  });

  it("counts a payment in conflict too, because the server has not counted it", () => {
    expect(waitingTotals([op("a", 1, S1, { state: "conflict", conflict: "refused" })]).count).toBe(1);
  });

  it("adds 30 payments of one store exactly", () => {
    const t = waitingTotals(Array.from({ length: 30 }, (_, i) => op(`p${i}`, i + 1, S1, { amount: "0.10" })));
    expect(t.paisa).toBe(300);
    expect(formatWaiting(t)).toBe("30 payments waiting on this phone, PKR 3.00, not counted yet");
  });

  it("adds the largest amount without losing a paisa", () => {
    const t = waitingTotals(amounts("9999999999.99", "9999999999.99"));
    expect(t.paisa).toBe(1_999_999_999_998);
    expect(formatWaiting(t)).toBe("2 payments waiting on this phone, PKR 19,999,999,999.98, not counted yet");
  });
});

describe("naming the server's refusal", () => {
  it("names the three conflicts", () => {
    expect(conflictFromAnswer({ code: "not_found", status: 404 })).toBe("not_found");
    expect(conflictFromAnswer({ code: "request_reused", status: 409 })).toBe("request_reused");
    expect(conflictFromAnswer({ code: "validation_error", status: 400 })).toBe("refused");
  });

  it("names nothing for an answer that is not a refusal of this payment", () => {
    for (const code of ["server_error", "network", "unauthenticated", "rate_limited", "something_else"]) {
      expect(conflictFromAnswer({ code, status: 500 }), code).toBeNull();
    }
  });
});
