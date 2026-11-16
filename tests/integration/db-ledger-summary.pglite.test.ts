import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayInPakistan } from "../../src/lib/orders/dates";
import {
  dbAdjustmentAdd,
  dbEntryReverse,
  dbOpeningAdd,
  dbPaymentAdd,
  issueInvoiceOf,
  seedAccountStore,
} from "../helpers/accounts-db";
import { scanForbiddenKeys } from "../helpers/invoices";
import { createInvoiceDraft, dbInvoiceCancel, dbInvoiceGet, seedInvoiceOrder } from "../helpers/invoices-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// The Account Summary snapshot saved at issue (User Story 5, master prompt Section 17 item 28): the five figures,
// what "previous balance" means, and that nothing recorded later can change it.

let db: PGlite;
let a: Tenant;

const TODAY = todayInPakistan();

async function summaryOf(invoiceId: string) {
  const got = await dbInvoiceGet(db, a.userId, invoiceId);
  if (!got.found) throw new Error("invoice not found");
  return got;
}

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "ledger-summary");
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("the five figures", () => {
  it("shows previous 0, this invoice, no payment and balance due for a first invoice", async () => {
    const store = await seedAccountStore(db, a, "First invoice");
    const invoice = await issueInvoiceOf(db, a, store, "1000.00");
    expect(invoice.account_summary).toEqual({
      balance_date: invoice.invoice_date,
      previous_balance: "0.00",
      previous_is_advance: false,
      this_invoice: "1000.00",
      payment_received: null,
      balance_due: "1000.00",
      due_is_advance: false,
    });
  });

  it("adds the previous balance and takes off a payment received now", async () => {
    const store = await seedAccountStore(db, a, "Carry forward summary");
    await dbOpeningAdd(db, a.userId, store, "5000.00", "owes", "2026-10-01");
    const invoice = await issueInvoiceOf(db, a, store, "8000.00", { payment: "3000.00" });
    expect(invoice.account_summary).toMatchObject({ previous_balance: "5000.00", this_invoice: "8000.00", payment_received: "3000.00", balance_due: "10000.00" });
  });

  it("supports an advance before the invoice (the previous balance is a credit)", async () => {
    const store = await seedAccountStore(db, a, "Advance before");
    await dbOpeningAdd(db, a.userId, store, "300.00", "advance", "2026-10-01");
    const invoice = await issueInvoiceOf(db, a, store, "200.00");
    expect(invoice.account_summary).toMatchObject({ previous_balance: "-300.00", previous_is_advance: true, this_invoice: "200.00", balance_due: "-100.00", due_is_advance: true });
  });

  it("can have a balance due smaller than the invoice or zero", async () => {
    const store = await seedAccountStore(db, a, "Zero due");
    await dbOpeningAdd(db, a.userId, store, "500.00", "advance", "2026-10-01");
    const invoice = await issueInvoiceOf(db, a, store, "500.00");
    expect(invoice.account_summary).toMatchObject({ previous_balance: "-500.00", balance_due: "0.00", due_is_advance: false });
  });

  it("is not there for a draft", async () => {
    const seed = await seedInvoiceOrder(db, a, { storeName: "Draft summary" });
    const draft = await createInvoiceDraft(db, a.userId, seed.order.id);
    expect(draft.in_account).toBe(false);
    expect(draft.account_summary).toBeNull();
    expect(draft.payment_status).toBeNull();
  });
});

describe("previous balance reads the entries recorded before the invoice, whatever their dates", () => {
  it("counts an entry recorded earlier even when it is dated later, and ignores one recorded later even when it is dated earlier", async () => {
    const store = await seedAccountStore(db, a, "Recording order");
    const first = await issueInvoiceOf(db, a, store, "1000.00");
    // recorded AFTER the first invoice but dated before it: the first invoice's summary must not change
    await dbOpeningAdd(db, a.userId, store, "500.00", "owes", "2026-01-01");
    const second = await issueInvoiceOf(db, a, store, "200.00");
    expect(first.account_summary?.previous_balance).toBe("0.00");
    expect(second.account_summary?.previous_balance).toBe("1500.00");
    expect(second.account_summary?.balance_due).toBe("1700.00");
    expect((await summaryOf(first.id)).account_summary).toEqual(first.account_summary);
  });
});

describe("nothing recorded later changes a saved summary", () => {
  it("keeps the figures identical after payments, adjustments, opening balances and reversals", async () => {
    const store = await seedAccountStore(db, a, "Frozen summary");
    const invoice = await issueInvoiceOf(db, a, store, "3000.00", { payment: "1000.00" });
    const before = await summaryOf(invoice.id);
    const columnsBefore = await db.query(`select in_account, summary_previous::text, summary_payment::text, summary_due::text from public.invoices where id = $1`, [invoice.id]);

    const payment = await dbPaymentAdd(db, a.userId, store, "500.00", TODAY);
    await dbAdjustmentAdd(db, a.userId, store, "50.00", "reduce", "Small amount forgiven");
    await dbOpeningAdd(db, a.userId, store, "10.00", "owes", "2026-01-01");
    await dbEntryReverse(db, a.userId, payment.entry!.id, "Wrong store");

    const after = await summaryOf(invoice.id);
    expect(after.account_summary).toEqual(before.account_summary);
    expect(after.account_summary).toMatchObject({ previous_balance: "0.00", this_invoice: "3000.00", payment_received: "1000.00", balance_due: "2000.00" });
    const columnsAfter = await db.query(`select in_account, summary_previous::text, summary_payment::text, summary_due::text from public.invoices where id = $1`, [invoice.id]);
    expect(columnsAfter.rows).toEqual(columnsBefore.rows);
  });

  it("keeps the snapshot of a cancelled invoice in the data", async () => {
    const store = await seedAccountStore(db, a, "Cancelled snapshot");
    const invoice = await issueInvoiceOf(db, a, store, "700.00");
    const cancelled = await dbInvoiceCancel(db, a.userId, invoice.id, "Wrong quantities");
    expect(cancelled.done).toBe(true);
    const got = await summaryOf(invoice.id);
    expect(got.status).toBe("cancelled");
    expect(got.account_summary).toMatchObject({ previous_balance: "0.00", this_invoice: "700.00", balance_due: "700.00" });
    // a cancelled invoice shows no paid status
    expect(got.payment_status).toBeNull();
  });
});

describe("the snapshot cannot be changed", () => {
  it("refuses every update of the four account columns of an issued invoice, as the table owner", async () => {
    const store = await seedAccountStore(db, a, "Immutable snapshot");
    const invoice = await issueInvoiceOf(db, a, store, "100.00", { payment: "40.00" });
    for (const set of [
      "in_account = false, summary_previous = null, summary_payment = null, summary_due = null",
      "in_account = false",
      "summary_previous = 999",
      "summary_payment = 1",
      "summary_due = 999",
      "summary_payment = null",
    ]) {
      await expect(db.query(`update public.invoices set ${set} where id = $1`, [invoice.id]), set).rejects.toThrow(/invoice_immutable/);
    }
    // and the same for a cancelled invoice
    const cancelled = await issueInvoiceOf(db, a, store, "100.00");
    await dbInvoiceCancel(db, a.userId, cancelled.id, "Wrong store");
    await expect(db.query(`update public.invoices set summary_previous = 5 where id = $1`, [cancelled.id])).rejects.toThrow(/invoice_immutable/);
  });

  it("returns no forbidden key", async () => {
    const store = await seedAccountStore(db, a, "Summary no cost");
    const invoice = await issueInvoiceOf(db, a, store, "250.00", { payment: "50.00" });
    expect(scanForbiddenKeys(invoice)).toEqual([]);
    expect(scanForbiddenKeys(await summaryOf(invoice.id))).toEqual([]);
  });
});
