import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayInPakistan } from "../../src/lib/orders/dates";
import {
  dbAdjustmentAdd,
  dbOpeningAdd,
  dbPaymentAdd,
  dbStatement,
  dbStores,
  dbSummary,
  issueInvoiceOf,
  rawEntries,
  seedAccountStore,
} from "../helpers/accounts-db";
import { scanForbiddenKeys } from "../helpers/invoices";
import { dbInvoiceCancel } from "../helpers/invoices-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// The Store Statement data and the totals (User Story 7): opening + debits - credits = closing for any range, the
// running balance, the 2,000-line cap, and Home totals equal to the stores list.

let db: PGlite;
let a: Tenant;
let b: Tenant;
let store: string;

const TODAY = todayInPakistan();
const paisa = (text: string): number => Math.round(Number(text) * 100);

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "ledger-statement-a");
  b = await createTenant(db, "ledger-statement-b");
  store = await seedAccountStore(db, a, "Statement store");
  // entries on several days (the dates are not in the order they were recorded)
  await dbOpeningAdd(db, a.userId, store, "1000.00", "owes", "2026-10-01");
  await dbPaymentAdd(db, a.userId, store, "300.00", "2026-11-05", { reference: "R-5" });
  await dbAdjustmentAdd(db, a.userId, store, "20.00", "reduce", "Small amount forgiven", { date: "2026-11-06" });
  await dbOpeningAdd(db, a.userId, store, "50.00", "advance", "2026-09-15"); // recorded last, dated earliest
  const invoice = await issueInvoiceOf(db, a, store, "500.00");
  await dbInvoiceCancel(db, a.userId, invoice.id, "Wrong quantities"); // a reversal dated today
  await issueInvoiceOf(db, a, store, "250.00");
}, 180_000);

afterAll(async () => {
  await db.close();
});

async function statement(from: string, to: string) {
  const res = await dbStatement(db, a.userId, store, from, to);
  if (!res.found || res.valid === false) throw new Error(`statement refused: ${JSON.stringify(res)}`);
  return res;
}

describe("the statement of a range", () => {
  const RANGES: Array<[string, string]> = [
    ["2000-01-01", "2999-12-31"],
    ["2026-10-01", "2026-11-30"],
    ["2026-11-05", "2026-11-05"],
    ["2026-09-01", "2026-09-30"],
    ["2026-10-02", "2026-11-04"],
    ["2026-11-06", TODAY],
    ["2026-01-01", "2026-01-31"],
    [TODAY, TODAY],
  ];

  for (const [from, to] of RANGES) {
    it(`opening + debits - credits = closing (${from} to ${to})`, async () => {
      const s = await statement(from, to);
      expect(paisa(s.opening_balance) + paisa(s.total_debit) - paisa(s.total_credit)).toBe(paisa(s.closing_balance));

      // the opening balance is the sum of everything dated before the range
      const all = await rawEntries(db, a.businessId, store);
      const before = all.filter((e) => e.entry_date < from).reduce((sum, e) => sum + paisa(e.debit) - paisa(e.credit), 0);
      expect(paisa(s.opening_balance)).toBe(before);

      // the entries are the ones dated in the range, in (date, order of recording) order, with the right running balance
      const inRange = all.filter((e) => e.entry_date >= from && e.entry_date <= to).sort((x, y) => (x.entry_date === y.entry_date ? Number(x.seq) - Number(y.seq) : x.entry_date < y.entry_date ? -1 : 1));
      expect(s.entries.map((e) => e.id)).toEqual(inRange.map((e) => e.id));
      let running = before;
      for (const [index, entry] of s.entries.entries()) {
        running += (entry.side === "debit" ? 1 : -1) * paisa(entry.amount);
        expect(paisa(entry.running_balance!), `running balance of line ${index}`).toBe(running);
      }
      expect(paisa(s.closing_balance)).toBe(running);
      expect(s.truncated).toBe(false);
      expect(s.from).toBe(from);
      expect(s.to).toBe(to);
    });
  }

  it("lists reversals and the pair of a cancelled invoice, and says nothing about cost", async () => {
    const s = await statement("2000-01-01", "2999-12-31");
    const types = s.entries.map((e) => e.entry_type);
    expect(types).toEqual(expect.arrayContaining(["opening_balance", "payment", "adjustment", "invoice", "reversal"]));
    expect(s.entries.filter((e) => e.entry_type === "invoice")).toHaveLength(2);
    expect(s.entries.filter((e) => e.entry_type === "reversal")).toHaveLength(1);
    expect(s.business.name).toBeTruthy();
    expect(s.store).toMatchObject({ id: store, name: "Statement store" });
    expect(scanForbiddenKeys(s)).toEqual([]);
  });

  it("shows equal opening and closing for a range with no entries", async () => {
    const s = await statement("2026-01-01", "2026-01-31");
    expect(s.entries).toEqual([]);
    expect(s.opening_balance).toBe("0.00");
    expect(s.closing_balance).toBe("0.00");
    const later = await statement("2026-11-07", "2026-11-08");
    expect(later.entries).toEqual([]);
    expect(later.closing_balance).toBe(later.opening_balance);
  });

  it("answers found false for another business's store and refuses a start date after the end date", async () => {
    const storeB = await seedAccountStore(db, b, "Other business statement");
    expect(await dbStatement(db, a.userId, storeB, "2026-01-01", "2026-12-31")).toEqual({ found: false });
    expect(await dbStatement(db, a.userId, randomUUID(), "2026-01-01", "2026-12-31")).toEqual({ found: false });
    expect(await dbStatement(db, a.userId, store, "2026-12-31", "2026-01-01")).toMatchObject({ found: true, valid: false, reason: "invalid_range" });
  });
});

describe("the 2,000-line cap", () => {
  it("returns 2,000 lines, says it was cut, and still totals every entry of the range", async () => {
    const big = await seedAccountStore(db, a, "Very long account");
    // 2,005 entries of 1.00 each in one day, inserted directly as the table owner (a bulk set-up)
    await db.query(
      `insert into public.ledger_entries (id, business_id, store_id, entry_type, entry_date, debit)
       select gen_random_uuid(), $1, $2, 'opening_balance', date '2026-11-01', 1.00 from generate_series(1, 2005)`,
      [a.businessId, big],
    );
    const res = await dbStatement(db, a.userId, big, "2026-11-01", "2026-11-01");
    if (!res.found || res.valid === false) throw new Error("statement refused");
    expect(res.entries).toHaveLength(2000);
    expect(res.truncated).toBe(true);
    expect(res.total_debit).toBe("2005.00");
    expect(res.closing_balance).toBe("2005.00");
    const small = await dbStatement(db, a.userId, big, "2026-11-02", "2026-11-03");
    if (!small.found || small.valid === false) throw new Error("statement refused");
    expect(small.truncated).toBe(false);
    expect(small.opening_balance).toBe("2005.00");
  });
});

describe("the Home totals equal the stores list", () => {
  it("sums the positive balances as owed and reports advances separately", async () => {
    const owing = await seedAccountStore(db, b, "Owes");
    const advance = await seedAccountStore(db, b, "Has advance");
    await seedAccountStore(db, b, "Settled");
    await dbOpeningAdd(db, b.userId, owing, "700.00", "owes", "2026-10-01");
    await dbOpeningAdd(db, b.userId, advance, "250.00", "advance", "2026-10-01");
    await dbOpeningAdd(db, b.userId, owing, "50.00", "owes", "2026-10-02");

    const summary = await dbSummary(db, b.userId);
    const list = await dbStores(db, b.userId, { limit: 50 });
    const positive = list.items.filter((r) => paisa(r.balance) > 0);
    const negative = list.items.filter((r) => paisa(r.balance) < 0);
    expect(paisa(summary.total_owed)).toBe(positive.reduce((sum, r) => sum + paisa(r.balance), 0));
    expect(summary.stores_owing).toBe(positive.length);
    expect(paisa(summary.total_advance)).toBe(-negative.reduce((sum, r) => sum + paisa(r.balance), 0));
    expect(summary.stores_with_advance).toBe(negative.length);
    expect(summary).toMatchObject({ total_owed: "750.00", stores_owing: 1, total_advance: "250.00", stores_with_advance: 1 });
    // the stores that owe come first, and a store without entries is listed with 0.00
    expect(list.items[0]).toMatchObject({ name: "Owes", balance: "750.00" });
    expect(list.items.find((r) => r.name === "Settled")).toMatchObject({ balance: "0.00", entry_count: 0 });
    const onlyOwing = await dbStores(db, b.userId, { onlyOwing: true });
    expect(onlyOwing.items.map((r) => r.name)).toEqual(["Owes"]);
    expect(scanForbiddenKeys(summary)).toEqual([]);
  });

  it("gives all zeros for a business with no entries", async () => {
    const c = await createTenant(db, "ledger-statement-c");
    expect(await dbSummary(db, c.userId)).toEqual({ total_owed: "0.00", stores_owing: 0, total_advance: "0.00", stores_with_advance: 0 });
  });
});
