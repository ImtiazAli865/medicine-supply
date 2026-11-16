import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayInPakistan } from "../../src/lib/orders/dates";
import {
  balanceOf,
  dbAccount,
  dbAdjustmentAdd,
  dbAllocation,
  dbEntryReverse,
  dbOpeningAdd,
  dbPaymentAdd,
  issueInvoiceOf,
  rawEntries,
  seedAccountStore,
} from "../helpers/accounts-db";
import { scanForbiddenKeys } from "../helpers/invoices";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// Reversal entries instead of edits or deletes (master prompt Section 17 item 27, User Story 6): a payment, an
// opening balance and an adjustment can each be reversed once with a reason; nothing else can.

let db: PGlite;
let a: Tenant;
let b: Tenant;

const TODAY = todayInPakistan();

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "ledger-reversal-a");
  b = await createTenant(db, "ledger-reversal-b");
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("reversing the three kinds of entry", () => {
  it("reverses a payment on the opposite side with the same amount, dated today, and the statuses move back", async () => {
    const store = await seedAccountStore(db, a, "Reverse a payment");
    const invoice = await issueInvoiceOf(db, a, store, "1000.00");
    const payment = await dbPaymentAdd(db, a.userId, store, "1000.00", "2026-11-01");
    expect(await balanceOf(db, a.businessId, store)).toBe("0.00");

    const reversal = await dbEntryReverse(db, a.userId, payment.entry!.id, "Wrong store");
    expect(reversal).toMatchObject({ done: true, replayed: false });
    expect(reversal.entry).toMatchObject({ entry_type: "reversal", debit: "1000.00", credit: "0.00", side: "debit", note: "Wrong store", entry_date: TODAY, reverses_entry_id: payment.entry!.id });
    expect(reversal.reversed).toMatchObject({ id: payment.entry!.id, reversed: true, reversed_by_entry_id: reversal.entry!.id });
    expect(await balanceOf(db, a.businessId, store)).toBe("1000.00");
    const rows = await dbAllocation(db, a.userId, a.businessId, store);
    expect(rows.find((r) => r.invoice_id === invoice.id)).toMatchObject({ status: "unpaid", allocated: "0.00" });
    const account = await dbAccount(db, a.userId, store);
    if (!account.found) throw new Error("account not found");
    expect(account.entries.find((e) => e.id === payment.entry!.id)).toMatchObject({ reversed: true });
  });

  it("reverses an opening balance in either direction", async () => {
    const store = await seedAccountStore(db, a, "Reverse openings");
    const owes = await dbOpeningAdd(db, a.userId, store, "700.00", "owes", "2026-10-01");
    const advance = await dbOpeningAdd(db, a.userId, store, "200.00", "advance", "2026-10-02");
    expect(await balanceOf(db, a.businessId, store)).toBe("500.00");
    expect((await dbEntryReverse(db, a.userId, owes.entry!.id, "Typed twice")).entry).toMatchObject({ credit: "700.00", debit: "0.00" });
    expect((await dbEntryReverse(db, a.userId, advance.entry!.id, "Typed twice")).entry).toMatchObject({ debit: "200.00", credit: "0.00" });
    expect(await balanceOf(db, a.businessId, store)).toBe("0.00");
  });

  it("reverses an adjustment, and an invoice's payment received at issue", async () => {
    const store = await seedAccountStore(db, a, "Reverse adj and issue payment");
    const adjustment = await dbAdjustmentAdd(db, a.userId, store, "50.00", "reduce", "Forgiven");
    expect((await dbEntryReverse(db, a.userId, adjustment.entry!.id, "Forgiven by mistake")).done).toBe(true);
    expect(await balanceOf(db, a.businessId, store)).toBe("0.00");

    const invoice = await issueInvoiceOf(db, a, store, "300.00", { payment: "100.00" });
    const payment = (await rawEntries(db, a.businessId, store)).find((e) => e.entry_type === "payment")!;
    const reversal = await dbEntryReverse(db, a.userId, payment.id, "Money was not received");
    expect(reversal.done).toBe(true);
    // the reversal copies the invoice id for display only
    expect(reversal.entry).toMatchObject({ invoice_id: invoice.id, invoice_label: invoice.number_label });
    expect(await balanceOf(db, a.businessId, store)).toBe("300.00");
  });
});

describe("what cannot be reversed", () => {
  it("refuses a reversal of a reversal, a second reversal and an invoice entry", async () => {
    const store = await seedAccountStore(db, a, "Rules store");
    const payment = await dbPaymentAdd(db, a.userId, store, "40.00", TODAY);
    const first = await dbEntryReverse(db, a.userId, payment.entry!.id, "Wrong");
    expect(await dbEntryReverse(db, a.userId, first.entry!.id, "Undo the undo")).toMatchObject({ done: false, reason: "entry_is_reversal" });
    expect(await dbEntryReverse(db, a.userId, payment.entry!.id, "Again")).toMatchObject({ done: false, reason: "already_reversed" });
    await issueInvoiceOf(db, a, store, "90.00");
    const invoiceEntry = (await rawEntries(db, a.businessId, store)).find((e) => e.entry_type === "invoice")!;
    expect(await dbEntryReverse(db, a.userId, invoiceEntry.id, "By hand")).toMatchObject({ done: false, reason: "invoice_entry" });
    expect((await rawEntries(db, a.businessId, store)).filter((e) => e.entry_type === "reversal")).toHaveLength(1);
  });

  it("looks like a missing entry for another business's entry or an unknown id", async () => {
    const storeB = await seedAccountStore(db, b, "Other business reversal");
    const paymentB = await dbPaymentAdd(db, b.userId, storeB, "10.00", TODAY);
    expect(await dbEntryReverse(db, a.userId, paymentB.entry!.id, "Not mine")).toMatchObject({ done: false, reason: "not_found" });
    expect(await dbEntryReverse(db, a.userId, randomUUID(), "Unknown")).toMatchObject({ done: false, reason: "not_found" });
    expect(await rawEntries(db, b.businessId, storeB)).toHaveLength(1);
  });

  it("looks missing when the named store is not the entry's own store (the route names it)", async () => {
    const own = await seedAccountStore(db, a, "Named store own");
    const other = await seedAccountStore(db, a, "Named store other");
    const payment = await dbPaymentAdd(db, a.userId, own, "10.00", TODAY);
    expect(await dbEntryReverse(db, a.userId, payment.entry!.id, "Wrong store in the address", randomUUID(), other)).toMatchObject({ done: false, reason: "not_found" });
    expect((await rawEntries(db, a.businessId, own)).filter((e) => e.entry_type === "reversal")).toHaveLength(0);
    expect((await dbEntryReverse(db, a.userId, payment.entry!.id, "Right store", randomUUID(), own)).done).toBe(true);
  });

  it("needs a reason of 1 to 500 characters", async () => {
    const store = await seedAccountStore(db, a, "Reversal reason");
    const payment = await dbPaymentAdd(db, a.userId, store, "10.00", TODAY);
    expect(await dbEntryReverse(db, a.userId, payment.entry!.id, null)).toMatchObject({ done: false, reason: "reason_required" });
    expect(await dbEntryReverse(db, a.userId, payment.entry!.id, "  ")).toMatchObject({ done: false, reason: "reason_required" });
    expect(await dbEntryReverse(db, a.userId, payment.entry!.id, "x".repeat(501))).toMatchObject({ done: false, reason: "reason_too_long" });
    expect((await rawEntries(db, a.businessId, store)).filter((e) => e.entry_type === "reversal")).toHaveLength(0);
    expect((await dbEntryReverse(db, a.userId, payment.entry!.id, "x".repeat(500))).done).toBe(true);
  });
});

describe("exactly-once by the reversal id", () => {
  it("records one reversal for repeated requests and refuses the same id for another entry", async () => {
    const store = await seedAccountStore(db, a, "Reversal replay");
    const one = await dbPaymentAdd(db, a.userId, store, "10.00", TODAY);
    const two = await dbPaymentAdd(db, a.userId, store, "20.00", TODAY);
    const id = randomUUID();
    const first = await dbEntryReverse(db, a.userId, one.entry!.id, "Wrong", id);
    const again = await dbEntryReverse(db, a.userId, one.entry!.id, "Wrong", id);
    expect(first).toMatchObject({ done: true, replayed: false });
    expect(again).toMatchObject({ done: true, replayed: true });
    expect(await dbEntryReverse(db, a.userId, two.entry!.id, "Wrong", id)).toMatchObject({ done: false, reason: "request_reused" });
    expect((await rawEntries(db, a.businessId, store)).filter((e) => e.entry_type === "reversal")).toHaveLength(1);
  });

  it("returns no forbidden key", async () => {
    const store = await seedAccountStore(db, a, "Reversal no cost");
    const payment = await dbPaymentAdd(db, a.userId, store, "10.00", TODAY);
    expect(scanForbiddenKeys(await dbEntryReverse(db, a.userId, payment.entry!.id, "Reason"))).toEqual([]);
  });
});
