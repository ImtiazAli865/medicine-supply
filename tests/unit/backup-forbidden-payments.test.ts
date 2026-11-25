import { describe, expect, it } from "vitest";
import { findForbiddenKeys } from "@/lib/backup/file";

// The backup's forbidden-key check after Module 011 (T006): waiting payments are device data, so the key `payments` is allowed at
// `$.waiting` only, and `paymentId` only inside an entry of `$.waiting.payments`. Every other forbidden key is still found
// everywhere, also inside a payment entry.

const ID = "123e4567-e89b-42d3-a456-426614174000";

function fileWith(payments: unknown, extra: Record<string, unknown> = {}) {
  return { format: "medsupply-backup", version: 2, waiting: { orders: [], stores: [], payments }, ...extra };
}

const clean = { paymentId: ID, storeId: ID, amount: "5000.00", date: "2026-11-24", reference: null, syncState: "waiting", reason: null };

describe("forbidden keys with waiting payments", () => {
  it("accepts a clean waiting payment entry", () => {
    expect(findForbiddenKeys(fileWith([clean, { ...clean, paymentId: "x" }]))).toEqual([]);
  });

  it("finds the key payments anywhere except directly under $.waiting", () => {
    expect(findForbiddenKeys({ payments: [] })).toEqual(["$.payments"]);
    expect(findForbiddenKeys({ waiting: { orders: [{ payments: [] }], stores: [] } })).toEqual(["$.waiting.orders[0].payments"]);
    expect(findForbiddenKeys({ waiting: { deep: { payments: [] } } })).toEqual(["$.waiting.deep.payments"]);
    expect(findForbiddenKeys({ orders: [{ payments: [] }] })).toEqual(["$.orders[0].payments"]);
  });

  it("finds the count waitingPayments anywhere except directly under $.counts", () => {
    expect(findForbiddenKeys({ counts: { waitingPayments: 2 } })).toEqual([]);
    expect(findForbiddenKeys({ waiting: { waitingPayments: 2 } })).toEqual(["$.waiting.waitingPayments"]);
    expect(findForbiddenKeys({ waitingPayments: 2 })).toEqual(["$.waitingPayments"]);
    expect(findForbiddenKeys({ counts: { deep: { waitingPayments: 2 } } })).toEqual(["$.counts.deep.waitingPayments"]);
  });

  it("finds paymentId anywhere except inside an entry of $.waiting.payments", () => {
    expect(findForbiddenKeys({ orders: [{ paymentId: ID }] })).toEqual(["$.orders[0].paymentId"]);
    expect(findForbiddenKeys({ waiting: { orders: [{ paymentId: ID }], stores: [] } })).toEqual(["$.waiting.orders[0].paymentId"]);
    expect(findForbiddenKeys({ waiting: { payments: { paymentId: ID } } })).toEqual(["$.waiting.payments.paymentId"]); // not an array entry
  });

  for (const key of ["balance", "invoice", "invoice_id", "ledger", "ledger_entry", "cost", "unit_cost", "profit", "margin", "mrp", "selling_price", "purchase_price", "token", "password"]) {
    it(`still finds ${key} inside a payment entry`, () => {
      expect(findForbiddenKeys(fileWith([{ ...clean, [key]: "x" }]))).toEqual([`$.waiting.payments[0].${key}`]);
    });
    it(`still finds ${key} anywhere else in the file`, () => {
      expect(findForbiddenKeys({ stores: [{ [key]: "x" }] })).toEqual([`$.stores[0].${key}`]);
    });
  }

  it("finds a forbidden key next to the allowed payments array", () => {
    expect(findForbiddenKeys({ waiting: { orders: [], stores: [], payments: [], balance: "1" } })).toEqual(["$.waiting.balance"]);
  });
});
