import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayInPakistan } from "../../src/lib/orders/dates";
import {
  balanceOf,
  countEntries,
  dbAccount,
  dbAllocation,
  dbPaymentAdd,
  issueInvoiceOf,
  rawEntries,
  seedAccountStore,
} from "../helpers/accounts-db";
import {
  createInvoiceDraft,
  dbInvoiceDiscard,
  dbInvoiceIssue,
  dbInvoiceRefresh,
  dbInvoiceSetQuantities,
  seedInvoiceOrder,
} from "../helpers/invoices-db";
import { typedLine } from "../helpers/orders";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// Issued invoices enter the account exactly once; drafts never do (User Story 2). The master prompt example is
// proven here: 20,000 of goods and a 15,000 payment give 5,000, an 8,000 delivery gives 13,000, a 10,000 payment 3,000.

let db: PGlite;
let a: Tenant;

const TODAY = todayInPakistan();

async function lastNumber(): Promise<number> {
  const res = await db.query<{ n: number }>(`select coalesce(max(last_number), 0)::int as n from public.invoice_counters where business_id = $1`, [a.businessId]);
  return res.rows[0].n;
}

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "ledger-invoice-entry");
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("drafts add no entry", () => {
  it("creating, editing, refreshing and discarding a draft never touches the account", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const before = await countEntries(db, a.businessId);
    const draft = await createInvoiceDraft(db, a.userId, seed.order.id);
    const edited = await dbInvoiceSetQuantities(db, a.userId, draft.id, draft.version, [{ line_id: draft.lines[0].id, delivered_quantity: 8 }]);
    expect(edited.done).toBe(true);
    const refreshed = await dbInvoiceRefresh(db, a.userId, draft.id, edited.invoice!.version);
    expect(refreshed.done).toBe(true);
    expect(await countEntries(db, a.businessId)).toBe(before);
    const discarded = await dbInvoiceDiscard(db, a.userId, draft.id, refreshed.invoice!.version);
    expect(discarded.done).toBe(true);
    expect(await countEntries(db, a.businessId)).toBe(before);
    const account = await dbAccount(db, a.userId, seed.seeded.storeId);
    if (!account.found) throw new Error("account not found");
    expect(account.balance).toBe("0.00");
  });
});

describe("issuing adds one invoice entry", () => {
  it("adds a debit equal to the grand total, dated the invoice date, linked to the invoice", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const draft = await createInvoiceDraft(db, a.userId, seed.order.id);
    const issued = await dbInvoiceIssue(db, a.userId, draft.id, draft.version);
    expect(issued.done).toBe(true);
    const invoice = issued.invoice!;
    expect(invoice.grand_total).toBe("2805.00");
    expect(invoice.in_account).toBe(true);
    const entries = await rawEntries(db, a.businessId, seed.seeded.storeId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entry_type: "invoice",
      debit: "2805.00",
      credit: "0.00",
      invoice_id: invoice.id,
      entry_date: invoice.invoice_date,
    });
    const account = await dbAccount(db, a.userId, seed.seeded.storeId);
    if (!account.found) throw new Error("account not found");
    expect(account.balance).toBe("2805.00");
    expect(account.entries[0]).toMatchObject({ entry_type: "invoice", invoice_label: invoice.number_label, side: "debit" });
  });

  it("uses the recomputed total, not a stale draft figure (a delivered quantity was lowered)", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const draft = await createInvoiceDraft(db, a.userId, seed.order.id);
    const panadol = draft.lines.find((l) => l.name.startsWith("Panadol"))!;
    const edited = await dbInvoiceSetQuantities(db, a.userId, draft.id, draft.version, [{ line_id: panadol.id, delivered_quantity: 8 }]);
    const issued = await dbInvoiceIssue(db, a.userId, draft.id, edited.invoice!.version);
    expect(issued.done).toBe(true);
    // 8 x 125.50 + 5 x 310.00 = 2554.00
    expect(issued.invoice!.grand_total).toBe("2554.00");
    const entries = await rawEntries(db, a.businessId, seed.seeded.storeId);
    expect(entries[0].debit).toBe("2554.00");
  });

  it("adds none on a replay, even when the issue request is repeated several times", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const draft = await createInvoiceDraft(db, a.userId, seed.order.id);
    const first = await dbInvoiceIssue(db, a.userId, draft.id, draft.version);
    for (let i = 0; i < 5; i += 1) {
      const again = await dbInvoiceIssue(db, a.userId, draft.id, draft.version);
      expect(again).toMatchObject({ done: true, replayed: true });
    }
    expect(first.done).toBe(true);
    expect(await rawEntries(db, a.businessId, seed.seeded.storeId)).toHaveLength(1);
  });

  it("adds no entry and uses no number when the issue is refused", async () => {
    const seed = await seedInvoiceOrder(db, a, { lines: () => [typedLine("Zinnat 250mg", 3, "strip")] });
    const draft = await createInvoiceDraft(db, a.userId, seed.order.id);
    const numberBefore = await lastNumber();
    const entriesBefore = await countEntries(db, a.businessId);
    const refused = await dbInvoiceIssue(db, a.userId, draft.id, draft.version);
    expect(refused).toMatchObject({ done: false, reason: "not_ready" });
    const stale = await dbInvoiceIssue(db, a.userId, draft.id, draft.version + 5);
    expect(stale).toMatchObject({ done: false, reason: "version_conflict" });
    expect(await countEntries(db, a.businessId)).toBe(entriesBefore);
    expect(await lastNumber()).toBe(numberBefore);
  });

  it("never lets one store's invoice appear in another store's account", async () => {
    const storeOne = await seedAccountStore(db, a, "Store One");
    const storeTwo = await seedAccountStore(db, a, "Store Two");
    await issueInvoiceOf(db, a, storeOne, "1000.00");
    expect(await balanceOf(db, a.businessId, storeOne)).toBe("1000.00");
    expect(await balanceOf(db, a.businessId, storeTwo)).toBe("0.00");
    expect(await rawEntries(db, a.businessId, storeTwo)).toEqual([]);
  });
});

describe("carry-forward (master prompt Section 17 items 16 and 25)", () => {
  it("20,000 of goods and a 15,000 payment give 5,000; 8,000 more gives 13,000; a 10,000 payment gives 3,000", async () => {
    const store = await seedAccountStore(db, a, "Carry forward");
    const first = await issueInvoiceOf(db, a, store, "20000.00");
    expect(await balanceOf(db, a.businessId, store)).toBe("20000.00");

    const pay1 = await dbPaymentAdd(db, a.userId, store, "15000.00", TODAY);
    expect(pay1.done).toBe(true);
    expect(pay1.account?.balance).toBe("5000.00");

    const second = await issueInvoiceOf(db, a, store, "8000.00");
    expect(await balanceOf(db, a.businessId, store)).toBe("13000.00");
    // After the first payment the first invoice is partly paid, the second unpaid.
    let rows = await dbAllocation(db, a.userId, a.businessId, store);
    expect(rows.find((r) => r.invoice_id === first.id)).toMatchObject({ allocated: "15000.00", outstanding: "5000.00", status: "partially_paid" });
    expect(rows.find((r) => r.invoice_id === second.id)).toMatchObject({ allocated: "0.00", outstanding: "8000.00", status: "unpaid" });

    const pay2 = await dbPaymentAdd(db, a.userId, store, "10000.00", TODAY);
    expect(pay2.account?.balance).toBe("3000.00");
    rows = await dbAllocation(db, a.userId, a.businessId, store);
    expect(rows.find((r) => r.invoice_id === first.id)).toMatchObject({ allocated: "20000.00", outstanding: "0.00", status: "paid" });
    expect(rows.find((r) => r.invoice_id === second.id)).toMatchObject({ allocated: "5000.00", outstanding: "3000.00", status: "partially_paid" });
    expect(await balanceOf(db, a.businessId, store)).toBe("3000.00");
  });
});

describe("an invoice with a grand total of 0.00", () => {
  it("is in the account with its summary saved but has no invoice entry, and counts as paid", async () => {
    const store = await seedAccountStore(db, a, "Zero invoice");
    const invoice = await issueInvoiceOf(db, a, store, "0.00");
    expect(invoice.grand_total).toBe("0.00");
    expect(invoice.in_account).toBe(true);
    expect(invoice.account_summary).toMatchObject({ previous_balance: "0.00", this_invoice: "0.00", balance_due: "0.00" });
    expect(invoice.payment_status).toBe("paid");
    expect(await rawEntries(db, a.businessId, store)).toEqual([]);
  });
});
