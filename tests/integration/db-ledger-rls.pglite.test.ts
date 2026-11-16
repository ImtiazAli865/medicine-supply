import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayInPakistan } from "../../src/lib/orders/dates";
import {
  countEntries,
  dbAccount,
  dbAdjustmentAdd,
  dbEntryReverse,
  dbInvoiceIssueWithPayment,
  dbOpeningAdd,
  dbPaymentAdd,
  dbPaymentPreview,
  dbStatement,
  dbStores,
  dbSummary,
  issueInvoiceOf,
  rawEntries,
  seedAccountStore,
} from "../helpers/accounts-db";
import { createInvoiceDraft, dbInvoiceCancel, dbInvoiceGet, dbInvoiceList, seedInvoiceOrder } from "../helpers/invoices-db";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";

// Business isolation for every function of Module 007 (and the changed invoice functions), on PGlite with crafted
// ids: a request for the other business's id gets exactly the answer of a missing id and changes nothing.

let db: PGlite;
let a: Tenant;
let b: Tenant;
let storeA: string;
let storeB: string;
let paymentA: string;
let invoiceA: string;
let draftB: { id: string; version: number };

const TODAY = todayInPakistan();

async function lastNumber(tenant: Tenant): Promise<number> {
  const res = await db.query<{ n: number }>(`select coalesce(max(last_number), 0)::int as n from public.invoice_counters where business_id = $1`, [tenant.businessId]);
  return res.rows[0].n;
}

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "ledger-rls-a");
  b = await createTenant(db, "ledger-rls-b");
  storeA = await seedAccountStore(db, a, "A store");
  storeB = await seedAccountStore(db, b, "B store");
  await dbOpeningAdd(db, a.userId, storeA, "1000.00", "owes", "2026-10-01");
  const payment = await dbPaymentAdd(db, a.userId, storeA, "100.00", TODAY);
  paymentA = payment.entry!.id;
  invoiceA = (await issueInvoiceOf(db, a, storeA, "500.00")).id;
  const seed = await seedInvoiceOrder(db, b, { storeName: "B draft store" });
  const draft = await createInvoiceDraft(db, b.userId, seed.order.id);
  draftB = { id: draft.id, version: draft.version };
}, 180_000);

afterAll(async () => {
  await db.close();
});

describe("reads of the other business's account answer like a missing one", () => {
  it("returns found false for the account, the preview and the statement", async () => {
    expect(await dbAccount(db, b.userId, storeA)).toEqual({ found: false });
    expect(await dbPaymentPreview(db, b.userId, storeA, "10.00")).toEqual({ found: false });
    expect(await dbStatement(db, b.userId, storeA, "2026-01-01", "2026-12-31")).toEqual({ found: false });
    // exactly what a store that does not exist gives
    expect(await dbAccount(db, b.userId, randomUUID())).toEqual({ found: false });
  });

  it("lists and totals only the caller's own stores", async () => {
    const list = await dbStores(db, b.userId, { limit: 50 });
    // B has two stores (the one made above and the one of its draft); A's store is never listed
    const ids = list.items.map((r) => r.store_id);
    expect(ids).toContain(storeB);
    expect(ids).not.toContain(storeA);
    expect(list.total).toBe(2);
    expect(list.items.every((r) => r.balance === "0.00" && r.entry_count === 0)).toBe(true);
    expect(await dbSummary(db, b.userId)).toEqual({ total_owed: "0.00", stores_owing: 0, total_advance: "0.00", stores_with_advance: 0 });
    const own = await dbSummary(db, a.userId);
    expect(own.total_owed).toBe("1400.00");
  });

  it("shows the other business's invoice as missing, with no paid status", async () => {
    expect(await dbInvoiceGet(db, b.userId, invoiceA)).toEqual({ found: false });
    const list = await dbInvoiceList(db, b.userId, { status: "all" });
    expect(list.items.find((i) => i.id === invoiceA)).toBeUndefined();
    const filtered = await dbInvoiceList(db, b.userId, { status: "all" });
    expect(filtered.total).toBe(1); // only B's own draft
  });
});

describe("writes against the other business change nothing", () => {
  it("refuses an opening balance, a payment, an adjustment and a reversal with not_found", async () => {
    const before = await countEntries(db, a.businessId);
    expect(await dbOpeningAdd(db, b.userId, storeA, "5.00", "owes", "2026-11-01")).toMatchObject({ done: false, reason: "not_found" });
    expect(await dbPaymentAdd(db, b.userId, storeA, "5.00", TODAY)).toMatchObject({ done: false, reason: "not_found" });
    expect(await dbAdjustmentAdd(db, b.userId, storeA, "5.00", "reduce", "Reason")).toMatchObject({ done: false, reason: "not_found" });
    expect(await dbEntryReverse(db, b.userId, paymentA, "Not mine")).toMatchObject({ done: false, reason: "not_found" });
    expect(await countEntries(db, a.businessId)).toBe(before);
    expect(await countEntries(db, b.businessId)).toBe(0);
  });

  it("refuses to issue or cancel the other business's invoice and uses no number", async () => {
    const numberA = await lastNumber(a);
    const numberB = await lastNumber(b);
    expect(await dbInvoiceCancel(db, b.userId, invoiceA, "Not mine")).toMatchObject({ done: false, reason: "not_found" });
    expect(await dbInvoiceIssueWithPayment(db, b.userId, invoiceA, 1, "10.00")).toMatchObject({ done: false, reason: "not_found" });
    expect(await lastNumber(a)).toBe(numberA);
    expect(await lastNumber(b)).toBe(numberB);
    expect((await rawEntries(db, a.businessId, storeA)).filter((e) => e.entry_type === "reversal")).toEqual([]);
  });

  it("keeps the entry ids of two businesses separate", async () => {
    const id = randomUUID();
    expect((await dbOpeningAdd(db, a.userId, storeA, "1.00", "owes", "2026-11-01", null, id)).done).toBe(true);
    expect((await dbOpeningAdd(db, b.userId, storeB, "2.00", "owes", "2026-11-01", null, id)).done).toBe(true);
    expect((await rawEntries(db, b.businessId, storeB)).find((e) => e.id === id)).toMatchObject({ debit: "2.00" });
    expect((await rawEntries(db, a.businessId, storeA)).find((e) => e.id === id)).toMatchObject({ debit: "1.00" });
  });

  it("numbers invoices per business (each business counts from 1)", async () => {
    const issuedB = await dbInvoiceIssueWithPayment(db, b.userId, draftB.id, draftB.version, "10.00");
    expect(issuedB.done).toBe(true);
    expect(issuedB.invoice?.number_label).toBe("INV-000001");
    expect((await dbInvoiceGet(db, a.userId, invoiceA)).found).toBe(true);
  });
});

describe("direct access and the internal helpers", () => {
  it("returns only the caller's own rows on a direct select and refuses every direct write", async () => {
    await withRole(db, "authenticated", b.userId, async () => {
      const own = await db.query<{ business_id: string }>(`select business_id from public.ledger_entries`);
      expect(own.rows.every((r) => r.business_id === b.businessId)).toBe(true);
      await expect(db.query(`insert into public.ledger_entries (id, store_id, entry_type, entry_date, debit) values ($1, $2, 'opening_balance', '2026-11-01', 5)`, [randomUUID(), storeB])).rejects.toThrow(/permission denied/i);
      await expect(db.query(`update public.ledger_entries set note = 'x'`)).rejects.toThrow(/permission denied/i);
      await expect(db.query(`delete from public.ledger_entries`)).rejects.toThrow(/permission denied/i);
    });
  });

  it("gives nothing when an internal helper is called directly with the other business's id", async () => {
    await withRole(db, "authenticated", b.userId, async () => {
      const balances = await db.query(`select * from public.ledger_balances($1::uuid)`, [a.businessId]);
      expect(balances.rows).toEqual([]);
      const allocation = await db.query(`select * from public.ledger_allocation($1::uuid, null, 0)`, [a.businessId]);
      expect(allocation.rows).toEqual([]);
      const entry = await db.query<{ r: unknown }>(`select public.ledger_entry_json($1::uuid, $2::uuid) as r`, [a.businessId, paymentA]);
      expect(entry.rows[0].r).toBeNull();
      const invoice = await db.query<{ r: unknown }>(`select public.invoice_json($1::uuid, $2::uuid, true) as r`, [a.businessId, invoiceA]);
      expect(invoice.rows[0].r).toBeNull();
    });
  });

  it("does not let a signed-in user call the insert function and gives a signed-out visitor nothing", async () => {
    await withRole(db, "authenticated", b.userId, async () => {
      await expect(
        db.query(`select public.ledger_insert_entry($1::uuid, $2::uuid, $3::uuid, 'opening_balance', '2026-11-01'::date, 5, 0, null, null, null, null, null)`, [b.businessId, storeB, randomUUID()]),
      ).rejects.toThrow(/permission denied/i);
    });
    const calls = [
      `select public.ledger_stores(null, false, 10, 0)`,
      `select public.ledger_summary()`,
      `select public.ledger_account('${storeA}'::uuid, 10, 0)`,
      `select public.ledger_payment_preview('${storeA}'::uuid, 5)`,
      `select public.ledger_statement('${storeA}'::uuid, '2026-01-01'::date, '2026-12-31'::date)`,
      `select public.ledger_opening_add('${randomUUID()}'::uuid, '${storeA}'::uuid, 5, 'owes', '2026-11-01'::date, null)`,
      `select public.ledger_payment_add('${randomUUID()}'::uuid, '${storeA}'::uuid, 5, '2026-11-01'::date, 'cash', null)`,
      `select public.ledger_adjustment_add('${randomUUID()}'::uuid, '${storeA}'::uuid, 5, 'reduce', 'x', null)`,
      `select public.ledger_entry_reverse('${randomUUID()}'::uuid, '${paymentA}'::uuid, 'x')`,
      `select public.invoice_issue('${invoiceA}'::uuid, 1, 5)`,
    ];
    await withRole(db, "anon", null, async () => {
      for (const sql of calls) {
        await expect(db.query(sql), sql).rejects.toThrow(/permission denied/i);
      }
    });
  });
});
