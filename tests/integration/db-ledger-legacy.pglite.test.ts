import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balanceOf, countEntries, dbAccount, issueInvoiceOf, rawEntries } from "../helpers/accounts-db";
import {
  createInvoiceDraft,
  dbInvoiceCancel,
  dbInvoiceGet,
  dbInvoiceList,
  issueInvoice,
  seedInvoiceOrder,
  type InvoiceSeed,
} from "../helpers/invoices-db";
import { applyMigrationFile, createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// Invoices issued BEFORE this module (the owner's decision: the khata starts empty). The database is built with
// migration 0007 only, invoices are issued and cancelled with the Module 006 functions, and then 0008 is applied.

let db: PGlite;
let a: Tenant;
let issuedSeed: InvoiceSeed;
let issuedId: string;
let issuedStore: string;
let cancelledId: string;
let counts: { invoices: number; issued: number; cancelled: number };

async function invoiceCounts(): Promise<{ invoices: number; issued: number; cancelled: number }> {
  const res = await db.query<{ invoices: number; issued: number; cancelled: number }>(
    `select count(*)::int as invoices,
            (count(*) filter (where status = 'issued'))::int as issued,
            (count(*) filter (where status = 'cancelled'))::int as cancelled
       from public.invoices where business_id = $1`,
    [a.businessId],
  );
  return res.rows[0];
}

beforeAll(async () => {
  db = await createTestDb({ upTo: "0007_invoices.sql" });
  a = await createTenant(db, "ledger-legacy");

  // An issued invoice (2,805.00) and a cancelled one, both made with the Module 006 functions.
  issuedSeed = await seedInvoiceOrder(db, a, { storeName: "Legacy store" });
  issuedStore = issuedSeed.seeded.storeId;
  const draft = await createInvoiceDraft(db, a.userId, issuedSeed.order.id);
  const issued = await issueInvoice(db, a.userId, draft);
  issuedId = issued.id;

  const second = await seedInvoiceOrder(db, a, { storeName: "Legacy store 2" });
  const draft2 = await createInvoiceDraft(db, a.userId, second.order.id);
  const issued2 = await issueInvoice(db, a.userId, draft2);
  const cancelled = await dbInvoiceCancel(db, a.userId, issued2.id, "Cancelled before the store accounts");
  expect(cancelled.done).toBe(true);
  cancelledId = issued2.id;

  counts = await invoiceCounts();
  await applyMigrationFile(db, "0008_store_accounts.sql");
}, 180_000);

afterAll(async () => {
  await db.close();
});

describe("after migration 0008", () => {
  it("keeps every invoice (the counts before and after are equal)", async () => {
    expect(await invoiceCounts()).toEqual(counts);
    expect(counts.issued).toBe(1);
    expect(counts.cancelled).toBe(1);
  });

  it("marks existing issued and cancelled invoices as not in the account, with no figures", async () => {
    const res = await db.query<{ id: string; in_account: boolean; summary_previous: string | null; summary_payment: string | null; summary_due: string | null }>(
      `select id, in_account, summary_previous::text, summary_payment::text, summary_due::text from public.invoices where business_id = $1`,
      [a.businessId],
    );
    expect(res.rows).toHaveLength(2);
    for (const row of res.rows) {
      expect(row).toMatchObject({ in_account: false, summary_previous: null, summary_payment: null, summary_due: null });
    }
  });

  it("leaves the ledger empty and the stores at 0.00", async () => {
    expect(await countEntries(db, a.businessId)).toBe(0);
    expect(await balanceOf(db, a.businessId, issuedStore)).toBe("0.00");
  });

  it("shows no payment status and no Account Summary for them", async () => {
    const got = await dbInvoiceGet(db, a.userId, issuedId);
    if (!got.found) throw new Error("invoice not found");
    expect(got.in_account).toBe(false);
    expect(got.payment_status).toBeNull();
    expect(got.amount_paid).toBeNull();
    expect(got.amount_outstanding).toBeNull();
    expect(got.account_summary).toBeNull();
    const cancelled = await dbInvoiceGet(db, a.userId, cancelledId);
    if (!cancelled.found) throw new Error("invoice not found");
    expect(cancelled.in_account).toBe(false);
    expect(cancelled.account_summary).toBeNull();
    const list = await dbInvoiceList(db, a.userId, {});
    for (const item of list.items) {
      expect(item).toMatchObject({ in_account: false, payment_status: null });
    }
  });

  it("adds no entry when a legacy issued invoice is cancelled, and the balance stays 0.00", async () => {
    const cancel = await dbInvoiceCancel(db, a.userId, issuedId, "Cancelling an old invoice");
    expect(cancel).toMatchObject({ done: true, replayed: false });
    expect(await countEntries(db, a.businessId)).toBe(0);
    expect(await balanceOf(db, a.businessId, issuedStore)).toBe("0.00");
    expect(await rawEntries(db, a.businessId)).toEqual([]);
  });

  it("puts new invoices issued after the migration in the account", async () => {
    const invoice = await issueInvoiceOf(db, a, issuedStore, "900.00");
    expect(invoice.in_account).toBe(true);
    expect(invoice.account_summary).toMatchObject({ previous_balance: "0.00", this_invoice: "900.00", balance_due: "900.00" });
    const account = await dbAccount(db, a.userId, issuedStore);
    if (!account.found) throw new Error("account not found");
    // only the new invoice is in the account; the legacy ones are not counted
    expect(account.balance).toBe("900.00");
    expect(account.entries).toHaveLength(1);
  });
});
