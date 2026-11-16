import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  balanceOf,
  countEntries,
  dbAccount,
  dbInvoiceIssueWithPayment,
  dbOpeningAdd,
  issueInvoiceOf,
  rawEntries,
  seedAccountStore,
} from "../helpers/accounts-db";
import { createInvoiceDraft, dbInvoiceGet, seedInvoiceOrder } from "../helpers/invoices-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// Issuing an invoice together with a payment received now (User Story 4): one atomic operation. A forced failure
// leaves no invoice number used, no invoice entry, no payment and the order unchanged (SC-008).

let db: PGlite;
let a: Tenant;

async function lastNumber(): Promise<number> {
  const res = await db.query<{ n: number }>(`select coalesce(max(last_number), 0)::int as n from public.invoice_counters where business_id = $1`, [a.businessId]);
  return res.rows[0].n;
}

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "ledger-issue-payment");
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("issue with a payment", () => {
  it("adds the invoice entry and one payment linked to the invoice, together, and saves the summary", async () => {
    const store = await seedAccountStore(db, a, "Pay at the door");
    await dbOpeningAdd(db, a.userId, store, "5000.00", "owes", "2026-10-01");
    const invoice = await issueInvoiceOf(db, a, store, "8000.00", { payment: "3000.00" });
    expect(invoice.status).toBe("issued");
    expect(invoice.in_account).toBe(true);
    expect(invoice.account_summary).toMatchObject({
      balance_date: invoice.invoice_date,
      previous_balance: "5000.00",
      previous_is_advance: false,
      this_invoice: "8000.00",
      payment_received: "3000.00",
      balance_due: "10000.00",
      due_is_advance: false,
    });
    const entries = (await rawEntries(db, a.businessId, store)).filter((e) => e.invoice_id === invoice.id);
    expect(entries.map((e) => e.entry_type).sort()).toEqual(["invoice", "payment"]);
    const payment = entries.find((e) => e.entry_type === "payment")!;
    expect(payment).toMatchObject({ credit: "3000.00", debit: "0.00", payment_method: "cash", entry_date: invoice.invoice_date });
    expect(await balanceOf(db, a.businessId, store)).toBe("10000.00");
  });

  it("behaves as before plus the invoice entry when no payment is given", async () => {
    const store = await seedAccountStore(db, a, "No payment");
    const invoice = await issueInvoiceOf(db, a, store, "400.00");
    expect(invoice.account_summary).toMatchObject({ payment_received: null, balance_due: "400.00" });
    const entries = await rawEntries(db, a.businessId, store);
    expect(entries.map((e) => e.entry_type)).toEqual(["invoice"]);
  });

  it("keeps a payment larger than the invoice total as an advance", async () => {
    const store = await seedAccountStore(db, a, "Overpay at the door");
    const invoice = await issueInvoiceOf(db, a, store, "8000.00", { payment: "9000.00" });
    expect(invoice.account_summary).toMatchObject({ previous_balance: "0.00", this_invoice: "8000.00", payment_received: "9000.00", balance_due: "-1000.00", due_is_advance: true });
    expect(invoice.payment_status).toBe("paid");
    expect(await balanceOf(db, a.businessId, store)).toBe("-1000.00");
    const account = await dbAccount(db, a.userId, store);
    if (!account.found) throw new Error("account not found");
    expect(account.advance).toBe(true);
  });

  it("shows the invoice as partly paid when the payment is less than the total", async () => {
    const store = await seedAccountStore(db, a, "Part payment");
    const invoice = await issueInvoiceOf(db, a, store, "1000.00", { payment: "250.00" });
    expect(invoice).toMatchObject({ payment_status: "partially_paid", amount_paid: "250.00", amount_outstanding: "750.00" });
  });
});

describe("refusals use no number and record nothing", () => {
  it("refuses an invalid payment before any number is taken", async () => {
    const store = await seedAccountStore(db, a, "Invalid payment");
    const seed = await seedInvoiceOrder(db, a, { storeName: "Invalid payment order" });
    const draft = await createInvoiceDraft(db, a.userId, seed.order.id);
    const numberBefore = await lastNumber();
    const entriesBefore = await countEntries(db, a.businessId);
    for (const payment of ["0", "-5.00", "1.234", "10000000000.00"]) {
      const res = await dbInvoiceIssueWithPayment(db, a.userId, draft.id, draft.version, payment);
      expect(res, payment).toMatchObject({ done: false, reason: "invalid_amount" });
      expect(res.fields?.payment_received).toBeTruthy();
    }
    expect(await lastNumber()).toBe(numberBefore);
    expect(await countEntries(db, a.businessId)).toBe(entriesBefore);
    const got = await dbInvoiceGet(db, a.userId, draft.id);
    if (!got.found) throw new Error("invoice not found");
    expect(got.status).toBe("draft");
    expect(store).toBeTruthy();
  });

  it("leaves no number, no entry, no payment and the order unchanged when a step fails (forced failure)", async () => {
    const seed = await seedInvoiceOrder(db, a, { storeName: "Forced failure" });
    const draft = await createInvoiceDraft(db, a.userId, seed.order.id);
    const numberBefore = await lastNumber();
    const entriesBefore = await countEntries(db, a.businessId);
    const orderBefore = await db.query<{ status: string; version: number }>(`select status, version from public.orders where id = $1`, [seed.order.id]);

    // A test-only trigger makes the write of the payment entry fail AFTER the invoice entry was written.
    await db.exec(`
      create function public.test_fail_payment() returns trigger language plpgsql as $$
      begin
        if new.entry_type = 'payment' and new.invoice_id is not null then
          raise exception 'forced failure while writing the payment';
        end if;
        return new;
      end $$;
      create trigger test_fail_payment before insert on public.ledger_entries
        for each row execute function public.test_fail_payment();
    `);
    try {
      await expect(dbInvoiceIssueWithPayment(db, a.userId, draft.id, draft.version, "100.00")).rejects.toThrow(/forced failure/);
    } finally {
      await db.exec(`drop trigger test_fail_payment on public.ledger_entries; drop function public.test_fail_payment();`);
    }

    expect(await lastNumber()).toBe(numberBefore);
    expect(await countEntries(db, a.businessId)).toBe(entriesBefore);
    const got = await dbInvoiceGet(db, a.userId, draft.id);
    if (!got.found) throw new Error("invoice not found");
    expect(got.status).toBe("draft");
    expect(got.invoice_number).toBeNull();
    expect(got.in_account).toBe(false);
    const orderAfter = await db.query<{ status: string; version: number }>(`select status, version from public.orders where id = $1`, [seed.order.id]);
    expect(orderAfter.rows[0]).toEqual(orderBefore.rows[0]);

    // and the same draft can still be issued afterwards
    const retry = await dbInvoiceIssueWithPayment(db, a.userId, draft.id, draft.version, "100.00");
    expect(retry).toMatchObject({ done: true, replayed: false });
    expect(await lastNumber()).toBe(numberBefore + 1);
  });
});

describe("a repeat never records a second payment", () => {
  it("returns the issued invoice and records no payment, whatever amount the repeat carries", async () => {
    const seed = await seedInvoiceOrder(db, a, { storeName: "Repeat" });
    const draft = await createInvoiceDraft(db, a.userId, seed.order.id);
    const first = await dbInvoiceIssueWithPayment(db, a.userId, draft.id, draft.version, "500.00");
    expect(first).toMatchObject({ done: true, replayed: false });
    for (const amount of ["500.00", "900.00", null, "0"]) {
      const again = await dbInvoiceIssueWithPayment(db, a.userId, draft.id, draft.version, amount);
      expect(again, String(amount)).toMatchObject({ done: true, replayed: true });
    }
    const entries = await rawEntries(db, a.businessId, seed.seeded.storeId);
    expect(entries.filter((e) => e.entry_type === "payment")).toHaveLength(1);
    expect(entries.filter((e) => e.entry_type === "invoice")).toHaveLength(1);
  });

  it("makes a second payment for one invoice impossible even by a direct insert", async () => {
    const store = await seedAccountStore(db, a, "Direct second payment");
    const invoice = await issueInvoiceOf(db, a, store, "300.00", { payment: "100.00" });
    await expect(
      db.query(
        `insert into public.ledger_entries (id, business_id, store_id, entry_type, entry_date, credit, payment_method, invoice_id)
         values ($1, $2, $3, 'payment', current_date, 5, 'cash', $4)`,
        [randomUUID(), a.businessId, store, invoice.id],
      ),
    ).rejects.toThrow(/duplicate|unique/i);
  });
});
