import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAccount, getAccountsSummary, getStatement, listAccounts, previewPayment, recordPayment } from "@/lib/accounts/repository";
import { issueInvoice, listInvoices } from "@/lib/invoices/repository";
import { AccountListQuerySchema, AccountQuerySchema, PaymentBodySchema, StatementQuerySchema } from "@/lib/validation/account";
import { InvoiceListQuerySchema } from "@/lib/validation/invoice";
import { draftInvoiceWithClient } from "../helpers/accounts";
import { createTenant, deleteTenant, hasTestEnv, serviceClient, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// SC-012: a store account with 2,000 entries opens (balance and first page) within 3 seconds, the stores list for 100
// stores with balances opens within 3 seconds, and a payment is recorded within 2 seconds. The Invoices list with the
// paid-status filter over 1,000 invoices is measured too. Run against the Supabase test project; every request is made
// as a real signed-in user. The times include the network round trip from this machine to the hosted project, but not
// the Next.js route or the browser. The bulk rows are seeded with the service role, in this test only (never in
// src/). Needs migration 0008 on the test project.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const OPEN_LIMIT_MS = 3_000;
const PAYMENT_LIMIT_MS = 2_000;
const RUNS = 5;
const TODAY = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

suite("store accounts at scale", () => {
  let a: TestTenant;
  let bigStore: string;
  let storeIds: string[];
  const measured: Record<string, number[]> = {};

  async function time<T>(label: string, run: () => Promise<T>): Promise<T> {
    const start = performance.now();
    const result = await run();
    (measured[label] ??= []).push(Math.round(performance.now() - start));
    return result;
  }

  async function timeRuns<T>(label: string, run: () => Promise<T>): Promise<T> {
    let last!: T;
    for (let i = 0; i < RUNS; i += 1) last = await time(label, run);
    return last;
  }

  async function insertChunks(table: string, rows: Record<string, unknown>[], size = 250) {
    const admin = serviceClient();
    for (let i = 0; i < rows.length; i += size) {
      const res = await admin.from(table).insert(rows.slice(i, i + size));
      if (res.error) throw new Error(`seed ${table}: ${res.error.message}`);
    }
  }

  const day = (offset: number) => new Date(Date.UTC(2026, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    a = await createTenant("accounts-scale");
    const businessId = a.businessId as string;

    // 100 stores: store 0 holds 2,000 entries, stores 1 to 50 hold the 1,000 invoices, the rest hold a few openings.
    const storeRows = Array.from({ length: 100 }, (_, i) => ({ id: randomUUID(), name: `Scale Account Store ${String(i).padStart(3, "0")}` }));
    const storeRes = await a.client.from("stores").insert(storeRows);
    if (storeRes.error) throw new Error(`seed stores: ${storeRes.error.message}`);
    storeIds = storeRows.map((s) => s.id);
    bigStore = storeIds[0];

    // 2,000 entries of the big store: 1,000 openings of 10.00 owed and 1,000 cash payments of 3.00 (balance 7,000.00).
    const big: Record<string, unknown>[] = [];
    for (let i = 0; i < 1000; i += 1) {
      big.push({ id: randomUUID(), business_id: businessId, store_id: bigStore, entry_type: "opening_balance", entry_date: day(i % 300), debit: "10.00", credit: "0.00" });
      big.push({ id: randomUUID(), business_id: businessId, store_id: bigStore, entry_type: "payment", entry_date: day(i % 300), debit: "0.00", credit: "3.00", payment_method: "cash" });
    }
    await insertChunks("ledger_entries", big);

    // a few openings in the stores 51 to 99 so that most stores have a balance
    const small = storeIds.slice(51).flatMap((store, s) =>
      Array.from({ length: 5 }, (_, j) => ({ id: randomUUID(), business_id: businessId, store_id: store, entry_type: "opening_balance", entry_date: day(j), debit: `${(s + 1) * 10}.00`, credit: "0.00" })),
    );
    await insertChunks("ledger_entries", small);

    // 1,000 issued invoices of 1,500.00 in the account (20 per store for the stores 1 to 50), each with its entry; every
    // store pays 17,000.00: 11 invoices paid, 1 partly paid (500.00), 8 unpaid.
    const now = Date.now();
    const orders = Array.from({ length: 1000 }, (_, i) => ({ i, id: randomUUID(), invoice: randomUUID(), store: storeIds[1 + (i % 50)] }));
    await insertChunks(
      "orders",
      orders.map((o) => ({ id: o.id, business_id: businessId, store_id: o.store, order_number: o.i + 1, status: "fulfilled", confirmed_at: new Date(now - (1000 - o.i) * 60_000).toISOString() })),
    );
    await insertChunks(
      "invoices",
      orders.map((o) => ({
        id: o.invoice,
        business_id: businessId,
        order_id: o.id,
        store_id: o.store,
        source_fingerprint: "x",
        grand_total: "1500.00",
        created_at: new Date(now - (1000 - o.i) * 60_000).toISOString(),
        status: "issued",
        invoice_number: o.i + 1,
        invoice_date: TODAY,
        issued_at: new Date(now).toISOString(),
        business_name: "Scale business",
        store_name: "Scale store",
        in_account: true,
        summary_previous: "0.00",
        summary_due: "1500.00",
      })),
    );
    await insertChunks("invoice_counters", [{ business_id: businessId, last_number: 1000 }]);
    await insertChunks(
      "ledger_entries",
      orders.map((o) => ({ id: randomUUID(), business_id: businessId, store_id: o.store, entry_type: "invoice", entry_date: day(300 + Math.floor(o.i / 50)), debit: "1500.00", credit: "0.00", invoice_id: o.invoice })),
    );
    await insertChunks(
      "ledger_entries",
      storeIds.slice(1, 51).map((store) => ({ id: randomUUID(), business_id: businessId, store_id: store, entry_type: "payment", entry_date: TODAY, debit: "0.00", credit: "17000.00", payment_method: "cash" })),
    );
  }, 900_000);

  afterAll(async () => {
    console.info(`SC-012 measured times in ms:\n${Object.entries(measured).map(([k, v]) => `  ${k}: ${v.join(", ")} (max ${Math.max(...v)})`).join("\n")}`);
    await deleteTenant(a);
  }, 600_000);

  it("opens a store account with 2,000 entries (balance and first page) within 3 seconds, with the right balance", async () => {
    const view = await timeRuns("account, 2,000 entries, first page", () => getAccount(a.client, bigStore, AccountQuerySchema.parse({})));
    expect(view.balance).toBe("7000.00");
    expect(view.total_entries).toBe(2000);
    expect(view.entries).toHaveLength(30);
    expect(view.entries[0].running_balance).toBe("7000.00");
    expect(Math.max(...measured["account, 2,000 entries, first page"])).toBeLessThan(OPEN_LIMIT_MS);
    const later = await timeRuns("account, 2,000 entries, last page", () => getAccount(a.client, bigStore, AccountQuerySchema.parse({ offset: "1980" })));
    expect(later.entries).toHaveLength(20);
    expect(Math.max(...measured["account, 2,000 entries, last page"])).toBeLessThan(OPEN_LIMIT_MS);
  }, 300_000);

  it("works out the statement of the big store for the whole range within 3 seconds, closing = opening + debits - credits", async () => {
    const statement = await timeRuns("statement, 2,000 entries", () => getStatement(a.client, bigStore, StatementQuerySchema.parse({ from: "2026-01-01", to: TODAY })));
    expect(statement.opening_balance).toBe("0.00");
    expect(statement.total_debit).toBe("10000.00");
    expect(statement.total_credit).toBe("3000.00");
    expect(statement.closing_balance).toBe("7000.00");
    expect(statement.entries.length).toBe(2000);
    expect(statement.truncated).toBe(false);
    expect(Math.max(...measured["statement, 2,000 entries"])).toBeLessThan(OPEN_LIMIT_MS);
  }, 300_000);

  it("works out the statement of one month and the Home summary within 3 seconds", async () => {
    const month = await timeRuns("statement, one month", () => getStatement(a.client, bigStore, StatementQuerySchema.parse({ from: "2026-03-01", to: "2026-03-31" })));
    expect(month.entries.length).toBeGreaterThan(0);
    expect(Number(month.opening_balance) + Number(month.total_debit) - Number(month.total_credit)).toBeCloseTo(Number(month.closing_balance), 2);
    const summary = await timeRuns("Home summary", () => getAccountsSummary(a.client));
    expect(summary.stores_owing).toBeGreaterThan(50);
    expect(Math.max(...measured["statement, one month"])).toBeLessThan(OPEN_LIMIT_MS);
    expect(Math.max(...measured["Home summary"])).toBeLessThan(OPEN_LIMIT_MS);
  }, 300_000);

  it("opens the stores list for 100 stores with balances within 3 seconds", async () => {
    const page = await timeRuns("stores list, 100 stores", () => listAccounts(a.client, AccountListQuerySchema.parse({ limit: "50" })));
    expect(page.total).toBe(100);
    expect(page.items).toHaveLength(50);
    const owing = await timeRuns("stores list, only owing", () => listAccounts(a.client, AccountListQuerySchema.parse({ only_owing: "true", limit: "50" })));
    expect(owing.items.every((row) => row.owes)).toBe(true);
    expect(Math.max(...measured["stores list, 100 stores"])).toBeLessThan(OPEN_LIMIT_MS);
    expect(Math.max(...measured["stores list, only owing"])).toBeLessThan(OPEN_LIMIT_MS);
  }, 300_000);

  it("records a payment and shows its preview for the big store within 2 seconds", async () => {
    await timeRuns("payment preview, 2,000 entries", () => previewPayment(a.client, bigStore, "1000.00"));
    for (let i = 0; i < RUNS; i += 1) {
      await time("record payment, 2,000 entries", () => recordPayment(a.client, bigStore, PaymentBodySchema.parse({ id: randomUUID(), amount: "1.00", date: TODAY })));
    }
    expect(Math.max(...measured["payment preview, 2,000 entries"])).toBeLessThan(PAYMENT_LIMIT_MS);
    expect(Math.max(...measured["record payment, 2,000 entries"])).toBeLessThan(PAYMENT_LIMIT_MS);
    const view = await getAccount(a.client, bigStore, AccountQuerySchema.parse({}));
    expect(view.balance).toBe("6995.00");
  }, 300_000);

  it("lists 1,000 invoices with paid statuses, with and without the paid filter, within 3 seconds", async () => {
    const first = await timeRuns("invoices list, 1,000 invoices, first page", () => listInvoices(a.client, InvoiceListQuerySchema.parse({})));
    expect(first.total).toBe(1000);
    expect(first.items.every((item) => item.payment_status !== null)).toBe(true);
    const unpaid = await timeRuns("invoices list, paid filter unpaid", () => listInvoices(a.client, InvoiceListQuerySchema.parse({ payment_status: "unpaid" })));
    // each of the 50 stores has 8 unpaid, 1 partly paid and 11 paid invoices
    expect(unpaid.total).toBe(400);
    const partly = await timeRuns("invoices list, paid filter partially_paid", () => listInvoices(a.client, InvoiceListQuerySchema.parse({ payment_status: "partially_paid" })));
    expect(partly.total).toBe(50);
    const paid = await timeRuns("invoices list, paid filter paid", () => listInvoices(a.client, InvoiceListQuerySchema.parse({ payment_status: "paid" })));
    expect(paid.total).toBe(550);
    for (const label of ["invoices list, 1,000 invoices, first page", "invoices list, paid filter unpaid", "invoices list, paid filter partially_paid", "invoices list, paid filter paid"]) {
      expect(Math.max(...measured[label]), label).toBeLessThan(OPEN_LIMIT_MS);
    }
  }, 300_000);

  it("issues an invoice together with a payment in a store with 2,000 entries within 2 seconds", async () => {
    for (let i = 0; i < RUNS; i += 1) {
      const draft = await draftInvoiceWithClient(a.client, bigStore, "250.00");
      const issued = await time("issue with payment, 2,000 entries", () => issueInvoice(a.client, draft.invoiceId, draft.version, "100.00"));
      expect(issued.invoice.in_account).toBe(true);
    }
    expect(Math.max(...measured["issue with payment, 2,000 entries"])).toBeLessThan(PAYMENT_LIMIT_MS);
  }, 600_000);
});
