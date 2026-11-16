import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayInPakistan } from "../../src/lib/orders/dates";
import { balanceOf, dbAccount, dbEntryReverse, issueInvoiceOf, rawEntries, seedAccountStore } from "../helpers/accounts-db";
import { createInvoiceDraft, dbInvoiceCancel, dbInvoiceIssue } from "../helpers/invoices-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// Cancelling an issued invoice that is in the account adds exactly one reversal in the same operation (User Story 2).
// A payment received with the invoice stays on the account. Invoices issued before the module are tested in
// db-ledger-legacy.

let db: PGlite;
let a: Tenant;

const TODAY = todayInPakistan();

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "ledger-cancel");
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("cancelling an invoice in the account", () => {
  it("adds exactly one reversal for the same amount, dated today with the cancellation reason, and the balance returns", async () => {
    const store = await seedAccountStore(db, a, "Cancel store");
    await issueInvoiceOf(db, a, store, "500.00"); // earlier balance 500
    const invoice = await issueInvoiceOf(db, a, store, "3000.00");
    expect(await balanceOf(db, a.businessId, store)).toBe("3500.00");

    const cancelled = await dbInvoiceCancel(db, a.userId, invoice.id, "Wrong quantities");
    expect(cancelled).toMatchObject({ done: true, replayed: false });
    expect(await balanceOf(db, a.businessId, store)).toBe("500.00");

    const entries = await rawEntries(db, a.businessId, store);
    const invoiceEntry = entries.find((e) => e.entry_type === "invoice" && e.invoice_id === invoice.id)!;
    const reversal = entries.find((e) => e.entry_type === "reversal")!;
    expect(reversal).toMatchObject({
      credit: "3000.00",
      debit: "0.00",
      reverses_entry_id: invoiceEntry.id,
      note: "Wrong quantities",
      entry_date: TODAY,
      invoice_id: invoice.id,
    });
    // both stay visible, the original marked as reversed
    const account = await dbAccount(db, a.userId, store);
    if (!account.found) throw new Error("account not found");
    expect(account.entries.find((e) => e.id === invoiceEntry.id)).toMatchObject({ reversed: true, reversed_by_entry_id: reversal.id });
    expect(account.entries).toHaveLength(3);
  });

  it("adds none on a repeat and keeps the first reason", async () => {
    const store = await seedAccountStore(db, a, "Cancel repeat");
    const invoice = await issueInvoiceOf(db, a, store, "700.00");
    expect((await dbInvoiceCancel(db, a.userId, invoice.id, "First reason")).done).toBe(true);
    for (let i = 0; i < 4; i += 1) {
      const again = await dbInvoiceCancel(db, a.userId, invoice.id, "Another reason");
      expect(again).toMatchObject({ done: true, replayed: true });
      expect(again.invoice?.cancel_reason).toBe("First reason");
    }
    const entries = await rawEntries(db, a.businessId, store);
    expect(entries.filter((e) => e.entry_type === "reversal")).toHaveLength(1);
    expect(await balanceOf(db, a.businessId, store)).toBe("0.00");
  });

  it("adds nothing when the cancel is refused (no reason)", async () => {
    const store = await seedAccountStore(db, a, "Cancel refused");
    const invoice = await issueInvoiceOf(db, a, store, "100.00");
    expect(await dbInvoiceCancel(db, a.userId, invoice.id, null)).toMatchObject({ done: false, reason: "reason_required" });
    expect(await dbInvoiceCancel(db, a.userId, invoice.id, "   ")).toMatchObject({ done: false, reason: "reason_required" });
    expect((await rawEntries(db, a.businessId, store)).filter((e) => e.entry_type === "reversal")).toHaveLength(0);
    expect(await balanceOf(db, a.businessId, store)).toBe("100.00");
  });

  it("leaves a payment received with the invoice on the account (it becomes an advance)", async () => {
    const store = await seedAccountStore(db, a, "Cancel with payment");
    const invoice = await issueInvoiceOf(db, a, store, "3000.00", { payment: "1000.00" });
    expect(await balanceOf(db, a.businessId, store)).toBe("2000.00");
    const cancelled = await dbInvoiceCancel(db, a.userId, invoice.id, "Customer refused the goods");
    expect(cancelled.done).toBe(true);
    // invoice 3000 debit, payment 1000 credit, reversal 3000 credit
    expect(await balanceOf(db, a.businessId, store)).toBe("-1000.00");
    const account = await dbAccount(db, a.userId, store);
    if (!account.found) throw new Error("account not found");
    expect(account.advance).toBe(true);
    const payment = account.entries.find((e) => e.entry_type === "payment")!;
    expect(payment.reversed).toBe(false);
    // the payment can be reversed separately, with its own reason
    const reversed = await dbEntryReverse(db, a.userId, payment.id, "Money returned to the store");
    expect(reversed.done).toBe(true);
    expect(await balanceOf(db, a.businessId, store)).toBe("0.00");
  });
});

describe("an invoice entry cannot be reversed by hand", () => {
  it("is refused with invoice_entry; cancelling the invoice is the only way", async () => {
    const store = await seedAccountStore(db, a, "Hand reversal");
    const invoice = await issueInvoiceOf(db, a, store, "250.00");
    const entry = (await rawEntries(db, a.businessId, store)).find((e) => e.entry_type === "invoice")!;
    expect(await dbEntryReverse(db, a.userId, entry.id, "Trying by hand")).toMatchObject({ done: false, reason: "invoice_entry" });
    expect(await balanceOf(db, a.businessId, store)).toBe("250.00");
    expect(invoice.in_account).toBe(true);
  });
});

describe("the replacement invoice", () => {
  it("gets a new number and its own entry after the first one was cancelled", async () => {
    const store = await seedAccountStore(db, a, "Replacement");
    const first = await issueInvoiceOf(db, a, store, "1200.00");
    expect((await dbInvoiceCancel(db, a.userId, first.id, "Wrong price")).done).toBe(true);
    // the order is confirmed again, so a new draft can be made for it
    const draft = await createInvoiceDraft(db, a.userId, first.order_id);
    const issued = await dbInvoiceIssue(db, a.userId, draft.id, draft.version);
    expect(issued.done).toBe(true);
    expect(issued.invoice!.invoice_number).toBeGreaterThan(first.invoice_number!);
    expect(issued.invoice!.in_account).toBe(true);
    const entries = await rawEntries(db, a.businessId, store);
    expect(entries.filter((e) => e.entry_type === "invoice")).toHaveLength(2);
    expect(entries.filter((e) => e.entry_type === "reversal")).toHaveLength(1);
    expect(await balanceOf(db, a.businessId, store)).toBe("1200.00");
  });
});
