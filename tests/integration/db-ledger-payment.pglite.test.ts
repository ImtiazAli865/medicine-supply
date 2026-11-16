import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayInPakistan } from "../../src/lib/orders/dates";
import {
  balanceOf,
  countEntries,
  dbAccount,
  dbAllocation,
  dbOpeningAdd,
  dbPaymentAdd,
  dbPaymentPreview,
  dbStores,
  issueInvoiceOf,
  rawEntries,
  seedAccountStore,
} from "../helpers/accounts-db";
import { scanForbiddenKeys } from "../helpers/invoices";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// Recording a payment (User Story 3): the entry, the refusals, the preview, exactly-once by the entry id and
// isolation between stores. The allocation itself is proven in db-ledger-allocation.

let db: PGlite;
let a: Tenant;
let b: Tenant;

const TODAY = todayInPakistan();

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "ledger-payment-a");
  b = await createTenant(db, "ledger-payment-b");
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("recording a payment", () => {
  it("adds one credit entry with the method, date and reference and returns the new balance", async () => {
    const store = await seedAccountStore(db, a, "Pay store");
    await issueInvoiceOf(db, a, store, "20000.00");
    const id = randomUUID();
    const res = await dbPaymentAdd(db, a.userId, store, "15000.00", "2026-11-10", { id, reference: "Receipt 12" });
    expect(res).toMatchObject({ done: true, replayed: false });
    expect(res.entry).toMatchObject({
      id,
      entry_type: "payment",
      entry_date: "2026-11-10",
      credit: "15000.00",
      debit: "0.00",
      side: "credit",
      payment_method: "cash",
      reference: "Receipt 12",
      invoice_id: null,
      reversed: false,
      mine: true,
    });
    expect(res.account).toEqual({ balance: "5000.00", advance: false });
    expect(await balanceOf(db, a.businessId, store)).toBe("5000.00");
  });

  it("treats a payment as belonging to the store account, not to an invoice", async () => {
    const store = await seedAccountStore(db, a, "Not linked");
    await issueInvoiceOf(db, a, store, "100.00");
    await dbPaymentAdd(db, a.userId, store, "40.00", TODAY);
    const payments = (await rawEntries(db, a.businessId, store)).filter((e) => e.entry_type === "payment");
    expect(payments).toHaveLength(1);
    expect(payments[0].invoice_id).toBeNull();
  });

  it("reports an advance when the payment is more than the balance", async () => {
    const store = await seedAccountStore(db, a, "Advance report");
    await dbOpeningAdd(db, a.userId, store, "3000.00", "owes", "2026-10-01");
    const res = await dbPaymentAdd(db, a.userId, store, "5000.00", TODAY);
    expect(res.account).toEqual({ balance: "-2000.00", advance: true });
  });

  it("accepts any past day, defaults the method to cash and accepts a payment on an archived store", async () => {
    const store = await seedAccountStore(db, a, "Archived store");
    await db.query(`update public.stores set is_active = false where id = $1`, [store]);
    expect((await dbPaymentAdd(db, a.userId, store, "10.00", "2000-01-01")).done).toBe(true);
    expect((await dbPaymentAdd(db, a.userId, store, "10.00", TODAY, { method: "" })).entry?.payment_method).toBe("cash");
    const account = await dbAccount(db, a.userId, store);
    if (!account.found) throw new Error("account not found");
    expect(account.store.is_active).toBe(false);
    expect(account.entries).toHaveLength(2);
    // an archived store is still listed
    const list = await dbStores(db, a.userId, { limit: 50 });
    expect(list.items.find((r) => r.store_id === store)).toMatchObject({ is_active: false, balance: "-20.00" });
  });
});

describe("refusals", () => {
  it("refuses zero, negative, three decimals, too large and a missing amount, and records nothing", async () => {
    const store = await seedAccountStore(db, a, "Refused payments");
    for (const amount of ["0", "0.00", "-1.00", "1.001", "10000000000.00", null]) {
      expect(await dbPaymentAdd(db, a.userId, store, amount, TODAY), String(amount)).toMatchObject({ done: false, reason: "invalid_amount" });
    }
    expect(await rawEntries(db, a.businessId, store)).toEqual([]);
  });

  it("refuses a future date, a date before 2000 and a missing date", async () => {
    const store = await seedAccountStore(db, a, "Refused dates");
    expect(await dbPaymentAdd(db, a.userId, store, "5.00", "2999-01-01")).toMatchObject({ done: false, reason: "invalid_date" });
    expect(await dbPaymentAdd(db, a.userId, store, "5.00", "1999-12-31")).toMatchObject({ done: false, reason: "invalid_date" });
    expect(await dbPaymentAdd(db, a.userId, store, "5.00", null as unknown as string)).toMatchObject({ done: false, reason: "invalid_date" });
    expect(await countEntries(db, a.businessId)).toBeGreaterThanOrEqual(0);
    expect(await rawEntries(db, a.businessId, store)).toEqual([]);
  });

  it("accepts only cash for now and a reference of at most 100 characters", async () => {
    const store = await seedAccountStore(db, a, "Method");
    expect(await dbPaymentAdd(db, a.userId, store, "5.00", TODAY, { method: "bank_transfer" })).toMatchObject({ done: false, reason: "invalid_method" });
    expect(await dbPaymentAdd(db, a.userId, store, "5.00", TODAY, { method: "cheque" })).toMatchObject({ done: false, reason: "invalid_method" });
    expect(await dbPaymentAdd(db, a.userId, store, "5.00", TODAY, { reference: "x".repeat(101) })).toMatchObject({ done: false, reason: "reference_too_long" });
    expect((await dbPaymentAdd(db, a.userId, store, "5.00", TODAY, { reference: "x".repeat(100) })).done).toBe(true);
  });

  it("treats a store of another business like a missing one", async () => {
    const storeB = await seedAccountStore(db, b, "Other business");
    expect(await dbPaymentAdd(db, a.userId, storeB, "5.00", TODAY)).toMatchObject({ done: false, reason: "not_found" });
    expect(await dbPaymentAdd(db, a.userId, randomUUID(), "5.00", TODAY)).toMatchObject({ done: false, reason: "not_found" });
    expect(await rawEntries(db, b.businessId, storeB)).toEqual([]);
  });
});

describe("exactly-once by the entry id", () => {
  it("records one payment for repeated requests with the same id and refuses the same id with other content", async () => {
    const store = await seedAccountStore(db, a, "Replay payments");
    await issueInvoiceOf(db, a, store, "1000.00");
    const id = randomUUID();
    const first = await dbPaymentAdd(db, a.userId, store, "300.00", TODAY, { id });
    expect(first).toMatchObject({ done: true, replayed: false });
    for (let i = 0; i < 5; i += 1) {
      const again = await dbPaymentAdd(db, a.userId, store, "300.00", TODAY, { id });
      expect(again).toMatchObject({ done: true, replayed: true });
      expect(again.account?.balance).toBe("700.00");
    }
    expect((await rawEntries(db, a.businessId, store)).filter((e) => e.entry_type === "payment")).toHaveLength(1);
    expect(await balanceOf(db, a.businessId, store)).toBe("700.00");
    const other = await seedAccountStore(db, a, "Other store same id");
    for (const attempt of [
      dbPaymentAdd(db, a.userId, store, "301.00", TODAY, { id }),
      dbPaymentAdd(db, a.userId, other, "300.00", TODAY, { id }),
      dbPaymentAdd(db, a.userId, store, "300.00", "2026-11-01", { id }),
    ]) {
      expect(await attempt).toMatchObject({ done: false, reason: "request_reused" });
    }
  });
});

describe("a payment for one store never touches another", () => {
  it("leaves the other store's balance, statuses and entries unchanged", async () => {
    const one = await seedAccountStore(db, a, "Store P1");
    const two = await seedAccountStore(db, a, "Store P2");
    const invoiceTwo = await issueInvoiceOf(db, a, two, "800.00");
    await dbPaymentAdd(db, a.userId, one, "800.00", TODAY);
    expect(await balanceOf(db, a.businessId, two)).toBe("800.00");
    const rows = await dbAllocation(db, a.userId, a.businessId, two);
    expect(rows.find((r) => r.invoice_id === invoiceTwo.id)).toMatchObject({ status: "unpaid", allocated: "0.00" });
    expect((await rawEntries(db, a.businessId, two)).filter((e) => e.entry_type === "payment")).toEqual([]);
  });
});

describe("the preview", () => {
  it("shows what recording will do and writes nothing", async () => {
    const store = await seedAccountStore(db, a, "Preview store");
    const opening = await dbOpeningAdd(db, a.userId, store, "1000.00", "owes", "2026-10-01");
    const invoice = await issueInvoiceOf(db, a, store, "500.00");
    const before = await countEntries(db, a.businessId);

    const preview = await dbPaymentPreview(db, a.userId, store, "1200.00");
    if (!preview.found) throw new Error("store not found");
    expect(preview.valid).toBe(true);
    expect(preview.balance_before).toBe("1500.00");
    expect(preview.balance_after).toBe("300.00");
    expect(preview.advance_after).toBe("0.00");
    expect(preview.settles).toHaveLength(2);
    expect(preview.settles[0]).toMatchObject({ kind: "opening_balance", label: "Opening balance", outstanding_before: "1000.00", applied: "1000.00", outstanding_after: "0.00" });
    expect(preview.settles[1]).toMatchObject({ kind: "invoice", label: invoice.number_label, outstanding_before: "500.00", applied: "200.00", outstanding_after: "300.00" });
    expect(await countEntries(db, a.businessId)).toBe(before);

    // recording the same amount gives exactly the allocation the preview showed
    await dbPaymentAdd(db, a.userId, store, "1200.00", TODAY);
    const rows = await dbAllocation(db, a.userId, a.businessId, store);
    expect(rows.find((r) => r.entry_id === opening.entry!.id)).toMatchObject({ allocated: "1000.00", outstanding: "0.00" });
    expect(rows.find((r) => r.invoice_id === invoice.id)).toMatchObject({ allocated: "200.00", outstanding: "300.00" });
    expect(scanForbiddenKeys(preview)).toEqual([]);
  });

  it("says how much would be kept as an advance", async () => {
    const store = await seedAccountStore(db, a, "Preview advance");
    await issueInvoiceOf(db, a, store, "3000.00");
    const preview = await dbPaymentPreview(db, a.userId, store, "5000.00");
    if (!preview.found) throw new Error("store not found");
    expect(preview.balance_after).toBe("-2000.00");
    expect(preview.advance_after).toBe("2000.00");
    expect(preview.settles).toHaveLength(1);
    expect(preview.settles[0]).toMatchObject({ applied: "3000.00", outstanding_after: "0.00" });
  });

  it("is not valid for a bad amount and not found for another business's store", async () => {
    const store = await seedAccountStore(db, a, "Preview bad");
    const bad = await dbPaymentPreview(db, a.userId, store, "0");
    expect(bad).toMatchObject({ found: true, valid: false, reason: "invalid_amount", settles: [] });
    const storeB = await seedAccountStore(db, b, "Preview other business");
    expect(await dbPaymentPreview(db, a.userId, storeB, "10.00")).toEqual({ found: false });
  });
});
