import type { PGlite } from "@electric-sql/pglite";
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
  type AllocationRow,
  type RawEntry,
} from "../helpers/accounts-db";
import { dbInvoiceCancel } from "../helpers/invoices-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// The allocation (master prompt Section 17 items 25 and 26): credits settle the open debit items oldest first,
// opening balances first, reversed entries ignored, an advance kept for the next invoice. Fixed cases, then
// randomised sequences checked against an independent implementation of the rules written in this file.

let db: PGlite;
let a: Tenant;

const TODAY = todayInPakistan();

const toPaisa = (text: string): number => Math.round(Number(text) * 100);
const fromPaisa = (paisa: number): string => (paisa / 100).toFixed(2);

interface Expected {
  entryId: string;
  amount: number;
  allocated: number;
  outstanding: number;
  status: string;
  kind: string;
}

/** The rules again, in integer paisa, from the raw entries only. */
function expectedAllocation(entries: RawEntry[]): { items: Expected[]; pool: number; debits: number } {
  const reversed = new Set(entries.filter((e) => e.entry_type === "reversal").map((e) => e.reverses_entry_id as string));
  const live = entries.filter((e) => e.entry_type !== "reversal" && !reversed.has(e.id));
  const pool = live.filter((e) => toPaisa(e.credit) > 0).reduce((sum, e) => sum + toPaisa(e.credit), 0);
  const debitItems = live
    .filter((e) => toPaisa(e.debit) > 0)
    .sort((x, y) => {
      const rx = x.entry_type === "opening_balance" ? 0 : 1;
      const ry = y.entry_type === "opening_balance" ? 0 : 1;
      if (rx !== ry) return rx - ry;
      if (x.entry_date !== y.entry_date) return x.entry_date < y.entry_date ? -1 : 1;
      return Number(x.seq) - Number(y.seq);
    });
  let before = 0;
  const items: Expected[] = [];
  for (const item of debitItems) {
    const amount = toPaisa(item.debit);
    const allocated = Math.min(amount, Math.max(0, pool - before));
    before += amount;
    items.push({
      entryId: item.id,
      amount,
      allocated,
      outstanding: amount - allocated,
      status: allocated >= amount ? "paid" : allocated === 0 ? "unpaid" : "partially_paid",
      kind: item.entry_type,
    });
  }
  return { items, pool, debits: before };
}

async function expectMatchesReference(storeId: string, label: string): Promise<void> {
  const entries = await rawEntries(db, a.businessId, storeId);
  const expected = expectedAllocation(entries);
  const rows = await dbAllocation(db, a.userId, a.businessId, storeId);
  expect(rows.length, `${label}: number of items`).toBe(expected.items.length);
  const byId = new Map<string, AllocationRow>(rows.map((r) => [r.entry_id, r]));
  for (const item of expected.items) {
    const row = byId.get(item.entryId);
    expect(row, `${label}: item ${item.entryId}`).toBeDefined();
    expect(row!.kind, label).toBe(item.kind);
    expect(toPaisa(row!.amount), `${label}: amount`).toBe(item.amount);
    expect(toPaisa(row!.allocated), `${label}: allocated`).toBe(item.allocated);
    expect(toPaisa(row!.outstanding), `${label}: outstanding`).toBe(item.outstanding);
    expect(row!.status, `${label}: status`).toBe(item.status);
    expect(toPaisa(row!.allocated), `${label}: no item over-allocated`).toBeLessThanOrEqual(toPaisa(row!.amount));
  }
  // Invariants: allocated adds up to the smaller of the credit pool and the open debits; the balance is open debits
  // minus the pool; the advance is the credit left over.
  const allocatedTotal = expected.items.reduce((sum, i) => sum + i.allocated, 0);
  expect(allocatedTotal, `${label}: allocated total`).toBe(Math.min(expected.pool, expected.debits));
  const balance = await balanceOf(db, a.businessId, storeId);
  expect(toPaisa(balance), `${label}: balance = debits - pool`).toBe(expected.debits - expected.pool);
  const account = await dbAccount(db, a.userId, storeId);
  if (!account.found) throw new Error("account not found");
  expect(account.balance, `${label}: account balance`).toBe(balance);
  expect(account.advance, `${label}: advance flag`).toBe(expected.pool > expected.debits);
  expect(account.owes, `${label}: owes flag`).toBe(expected.debits > expected.pool);
}

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "ledger-allocation");
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("fixed cases", () => {
  it("settles the opening balance first, then the invoice", async () => {
    const store = await seedAccountStore(db, a, "Opening then invoice");
    const opening = await dbOpeningAdd(db, a.userId, store, "1000.00", "owes", "2026-10-01");
    const invoice = await issueInvoiceOf(db, a, store, "500.00");
    await dbPaymentAdd(db, a.userId, store, "1200.00", TODAY);
    const rows = await dbAllocation(db, a.userId, a.businessId, store);
    expect(rows.find((r) => r.entry_id === opening.entry!.id)).toMatchObject({ allocated: "1000.00", outstanding: "0.00", status: "paid" });
    expect(rows.find((r) => r.invoice_id === invoice.id)).toMatchObject({ allocated: "200.00", outstanding: "300.00", status: "partially_paid" });
    await expectMatchesReference(store, "opening then invoice");
  });

  it("settles an opening balance before invoices even when its date is later", async () => {
    const store = await seedAccountStore(db, a, "Opening date later");
    const invoice = await issueInvoiceOf(db, a, store, "500.00");
    // the old balance is typed as "as on today" after the invoice was issued
    const opening = await dbOpeningAdd(db, a.userId, store, "1000.00", "owes", TODAY);
    await dbPaymentAdd(db, a.userId, store, "300.00", TODAY);
    const rows = await dbAllocation(db, a.userId, a.businessId, store);
    expect(rows.find((r) => r.entry_id === opening.entry!.id)).toMatchObject({ allocated: "300.00", status: "partially_paid" });
    expect(rows.find((r) => r.invoice_id === invoice.id)).toMatchObject({ allocated: "0.00", status: "unpaid" });
  });

  it("orders invoices by date and then by the order they were recorded", async () => {
    const store = await seedAccountStore(db, a, "Two invoices");
    const first = await issueInvoiceOf(db, a, store, "100.00");
    const second = await issueInvoiceOf(db, a, store, "100.00");
    await dbPaymentAdd(db, a.userId, store, "150.00", TODAY);
    const rows = await dbAllocation(db, a.userId, a.businessId, store);
    expect(rows.find((r) => r.invoice_id === first.id)).toMatchObject({ allocated: "100.00", status: "paid" });
    expect(rows.find((r) => r.invoice_id === second.id)).toMatchObject({ allocated: "50.00", status: "partially_paid" });
  });

  it("keeps an overpayment as an advance and uses it for the next invoice", async () => {
    const store = await seedAccountStore(db, a, "Advance");
    await issueInvoiceOf(db, a, store, "3000.00");
    await dbPaymentAdd(db, a.userId, store, "5000.00", TODAY);
    expect(await balanceOf(db, a.businessId, store)).toBe("-2000.00");
    const next = await issueInvoiceOf(db, a, store, "1500.00");
    expect(next.payment_status).toBe("paid");
    expect(next.amount_paid).toBe("1500.00");
    expect(await balanceOf(db, a.businessId, store)).toBe("-500.00");
    const account = await dbAccount(db, a.userId, store);
    if (!account.found) throw new Error("account not found");
    expect(account.advance).toBe(true);
    expect(account.open_items).toEqual([]);
  });

  it("never lets a cancelled invoice absorb a payment", async () => {
    const store = await seedAccountStore(db, a, "Cancelled absorbs nothing");
    const invoice = await issueInvoiceOf(db, a, store, "1000.00");
    await dbInvoiceCancel(db, a.userId, invoice.id, "Wrong store");
    await dbPaymentAdd(db, a.userId, store, "500.00", TODAY);
    expect(await balanceOf(db, a.businessId, store)).toBe("-500.00");
    expect(await dbAllocation(db, a.userId, a.businessId, store)).toEqual([]);
    await expectMatchesReference(store, "cancelled invoice");
  });

  it("ignores a reversed payment and its reversal, and the statuses move back", async () => {
    const store = await seedAccountStore(db, a, "Reverse payment");
    const invoice = await issueInvoiceOf(db, a, store, "1000.00");
    const payment = await dbPaymentAdd(db, a.userId, store, "1000.00", TODAY);
    let rows = await dbAllocation(db, a.userId, a.businessId, store);
    expect(rows.find((r) => r.invoice_id === invoice.id)?.status).toBe("paid");
    const reversed = await dbEntryReverse(db, a.userId, payment.entry!.id, "Wrong store");
    expect(reversed.done).toBe(true);
    rows = await dbAllocation(db, a.userId, a.businessId, store);
    expect(rows.find((r) => r.invoice_id === invoice.id)).toMatchObject({ allocated: "0.00", status: "unpaid" });
    await expectMatchesReference(store, "reversed payment");
  });

  it("removes a reversed opening balance from the open items", async () => {
    const store = await seedAccountStore(db, a, "Reverse opening");
    const opening = await dbOpeningAdd(db, a.userId, store, "400.00", "owes", "2026-10-01");
    await dbEntryReverse(db, a.userId, opening.entry!.id, "Typed twice");
    expect(await dbAllocation(db, a.userId, a.businessId, store)).toEqual([]);
    expect(await balanceOf(db, a.businessId, store)).toBe("0.00");
  });

  it("lets a reducing adjustment settle the oldest item and an increasing adjustment be an item itself", async () => {
    const store = await seedAccountStore(db, a, "Adjustments");
    const opening = await dbOpeningAdd(db, a.userId, store, "100.00", "owes", "2026-10-01");
    await dbAdjustmentAdd(db, a.userId, store, "40.00", "reduce", "Small amount forgiven");
    const increase = await dbAdjustmentAdd(db, a.userId, store, "25.00", "increase", "Rate difference");
    const rows = await dbAllocation(db, a.userId, a.businessId, store);
    expect(rows.find((r) => r.entry_id === opening.entry!.id)).toMatchObject({ allocated: "40.00", outstanding: "60.00", status: "partially_paid" });
    expect(rows.find((r) => r.entry_id === increase.entry!.id)).toMatchObject({ kind: "adjustment", amount: "25.00", allocated: "0.00", status: "unpaid" });
    await expectMatchesReference(store, "adjustments");
  });

  it("treats an opening balance of an advance as credit", async () => {
    const store = await seedAccountStore(db, a, "Advance opening");
    await dbOpeningAdd(db, a.userId, store, "300.00", "advance", "2026-10-01");
    const invoice = await issueInvoiceOf(db, a, store, "200.00");
    expect(invoice.payment_status).toBe("paid");
    expect(await balanceOf(db, a.businessId, store)).toBe("-100.00");
  });

  it("never mixes two stores", async () => {
    const one = await seedAccountStore(db, a, "Store one");
    const two = await seedAccountStore(db, a, "Store two");
    const invoice = await issueInvoiceOf(db, a, one, "700.00");
    await dbPaymentAdd(db, a.userId, two, "700.00", TODAY);
    const rows = await dbAllocation(db, a.userId, a.businessId, one);
    expect(rows.find((r) => r.invoice_id === invoice.id)).toMatchObject({ allocated: "0.00", status: "unpaid" });
    expect(await balanceOf(db, a.businessId, one)).toBe("700.00");
    expect(await balanceOf(db, a.businessId, two)).toBe("-700.00");
  });
});

// A small deterministic random generator so a failure can be repeated with the printed seed.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("randomised sequences (checked against the reference implementation in this file)", () => {
  const SEEDS = [11, 23, 42, 77, 101, 2026, 31337, 99991];

  for (const seed of SEEDS) {
    it(`keeps every invariant after every step (seed ${seed})`, async () => {
      const random = mulberry32(seed);
      const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)];
      const money = (maxPaisa: number): string => fromPaisa(1 + Math.floor(random() * maxPaisa));
      const dayOf = (): string => pick(["2026-10-01", "2026-10-15", "2026-11-01", "2026-11-10", TODAY]);

      const store = await seedAccountStore(db, a, `Random ${seed}`);
      const issued: string[] = [];
      const cancelled = new Set<string>();

      for (let step = 0; step < 14; step += 1) {
        const roll = random();
        let label = "";
        if (roll < 0.15) {
          label = "opening";
          const res = await dbOpeningAdd(db, a.userId, store, money(300000), random() < 0.75 ? "owes" : "advance", dayOf());
          expect(res.done, label).toBe(true);
        } else if (roll < 0.4) {
          label = "payment";
          const res = await dbPaymentAdd(db, a.userId, store, money(250000), dayOf());
          expect(res.done, label).toBe(true);
        } else if (roll < 0.5) {
          label = "adjustment";
          const res = await dbAdjustmentAdd(db, a.userId, store, money(5000), random() < 0.6 ? "reduce" : "increase", "Random adjustment", { date: dayOf() });
          expect(res.done, label).toBe(true);
        } else if (roll < 0.62) {
          label = "reverse";
          const entries = await rawEntries(db, a.businessId, store);
          const reversedIds = new Set(entries.filter((e) => e.entry_type === "reversal").map((e) => e.reverses_entry_id));
          const candidates = entries.filter((e) => e.entry_type !== "invoice" && e.entry_type !== "reversal" && !reversedIds.has(e.id));
          if (candidates.length > 0) {
            const res = await dbEntryReverse(db, a.userId, pick(candidates).id, "Random reversal");
            expect(res.done, label).toBe(true);
          }
        } else if (roll < 0.9) {
          label = "issue";
          const total = fromPaisa(100 + Math.floor(random() * 400000));
          const withPayment = random() < 0.3 ? money(100000) : null;
          const invoice = await issueInvoiceOf(db, a, store, total, { payment: withPayment });
          issued.push(invoice.id);
        } else {
          label = "cancel";
          const open = issued.filter((id) => !cancelled.has(id));
          if (open.length > 0) {
            const id = pick(open);
            const res = await dbInvoiceCancel(db, a.userId, id, "Random cancel");
            expect(res.done, label).toBe(true);
            cancelled.add(id);
          }
        }
        await expectMatchesReference(store, `seed ${seed} step ${step} (${label})`);
      }
    }, 120_000);
  }
});
