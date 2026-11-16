import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayInPakistan } from "../../src/lib/orders/dates";
import {
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
} from "../helpers/accounts-db";
import { scanForbiddenKeys } from "../helpers/invoices";
import { createInvoiceDraft, dbInvoiceCancel, dbInvoiceGet, dbInvoiceList, seedInvoiceOrder } from "../helpers/invoices-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// No purchase price, MRP, cost, margin or profit anywhere in the ledger (master prompt: never on the Account
// Summary or the Store Statement). The seeded medicines carry recognisable cost values (90.00, 130.00, 200.00, 350.00).

let db: PGlite;
let a: Tenant;

const TODAY = todayInPakistan();
const COST_VALUES = /(?<![\d.])(90|130|200|350)\.00(?!\d)/;
const FORBIDDEN_COLUMN = /purchase|mrp|cost|margin|profit/i;

function expectClean(label: string, value: unknown): void {
  expect(scanForbiddenKeys(value), `${label}: forbidden key`).toEqual([]);
  expect(JSON.stringify(value), `${label}: cost value`).not.toMatch(COST_VALUES);
}

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "ledger-nocost");
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("the tables", () => {
  it("has no cost-like column in ledger_entries or in the new invoice columns", async () => {
    const res = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name in ('ledger_entries')`,
    );
    expect(res.rows.filter((r) => FORBIDDEN_COLUMN.test(r.column_name))).toEqual([]);
    const inv = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'invoices'
          and column_name in ('in_account', 'summary_previous', 'summary_payment', 'summary_due')`,
    );
    expect(inv.rows).toHaveLength(4);
    expect(inv.rows.filter((r) => FORBIDDEN_COLUMN.test(r.column_name))).toEqual([]);
  });
});

describe("every function result of a business with every kind of entry", () => {
  it("returns no forbidden key and no cost value", async () => {
    // a store whose invoice (2,805.00) comes from medicines that carry purchase prices and an MRP
    const seed = await seedInvoiceOrder(db, a, { storeName: "No cost store" });
    const store = seed.seeded.storeId;
    expectClean("opening", await dbOpeningAdd(db, a.userId, store, "1234.50", "owes", "2026-10-01", "From the paper khata"));
    const draft = await createInvoiceDraft(db, a.userId, seed.order.id);
    const issued = await dbInvoiceIssueWithPayment(db, a.userId, draft.id, draft.version, "777.00");
    expect(issued.done).toBe(true);
    expectClean("issued with payment", issued);
    const payment = await dbPaymentAdd(db, a.userId, store, "55.00", TODAY, { reference: "R-9" });
    expectClean("payment", payment);
    expectClean("adjustment", await dbAdjustmentAdd(db, a.userId, store, "5.00", "reduce", "Small amount forgiven"));
    expectClean("reversal", await dbEntryReverse(db, a.userId, payment.entry!.id, "Wrong store"));
    expectClean("preview", await dbPaymentPreview(db, a.userId, store, "100.00"));
    expectClean("account", await dbAccount(db, a.userId, store, 50, 0));
    expectClean("stores", await dbStores(db, a.userId, {}));
    expectClean("summary", await dbSummary(db, a.userId));
    expectClean("statement", await dbStatement(db, a.userId, store, "2000-01-01", "2999-12-31"));
    expectClean("invoice", await dbInvoiceGet(db, a.userId, issued.invoice!.id));
    expectClean("invoice list", await dbInvoiceList(db, a.userId, {}));
    const cancelled = await dbInvoiceCancel(db, a.userId, issued.invoice!.id, "Wrong quantities");
    expect(cancelled.done).toBe(true);
    expectClean("cancelled invoice", cancelled);
    expectClean("statement after cancel", await dbStatement(db, a.userId, store, "2000-01-01", "2999-12-31"));
  });
});
