import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayInPakistan } from "../../src/lib/orders/dates";
import {
  balanceOf,
  dbAccount,
  dbAdjustmentAdd,
  dbAllocation,
  dbOpeningAdd,
  issueInvoiceOf,
  rawEntries,
  seedAccountStore,
} from "../helpers/accounts-db";
import { scanForbiddenKeys } from "../helpers/invoices";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// Adjustments (User Story 6): write off or add a small amount, always with a reason; append-only and reversible only
// by a reversal (see db-ledger-reversal).

let db: PGlite;
let a: Tenant;
let b: Tenant;

const TODAY = todayInPakistan();

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "ledger-adjustment-a");
  b = await createTenant(db, "ledger-adjustment-b");
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("adding an adjustment", () => {
  it("reduces what the store owes with a credit entry and shows the reason", async () => {
    const store = await seedAccountStore(db, a, "Write-off store");
    await dbOpeningAdd(db, a.userId, store, "4950.00", "owes", "2026-10-01");
    const id = randomUUID();
    const res = await dbAdjustmentAdd(db, a.userId, store, "50.00", "reduce", "Small amount forgiven", { id });
    expect(res).toMatchObject({ done: true, replayed: false });
    expect(res.entry).toMatchObject({ id, entry_type: "adjustment", credit: "50.00", debit: "0.00", side: "credit", note: "Small amount forgiven", entry_date: TODAY });
    expect(await balanceOf(db, a.businessId, store)).toBe("4900.00");
    const account = await dbAccount(db, a.userId, store);
    if (!account.found) throw new Error("account not found");
    expect(account.entries[0]).toMatchObject({ entry_type: "adjustment", note: "Small amount forgiven" });
    // a reducing adjustment settles the oldest item
    const rows = await dbAllocation(db, a.userId, a.businessId, store);
    expect(rows[0]).toMatchObject({ kind: "opening_balance", allocated: "50.00", outstanding: "4900.00" });
  });

  it("increases what the store owes with a debit entry and a chosen date", async () => {
    const store = await seedAccountStore(db, a, "Increase store");
    const res = await dbAdjustmentAdd(db, a.userId, store, "25.50", "increase", "Rate difference", { date: "2026-11-02" });
    expect(res.entry).toMatchObject({ debit: "25.50", credit: "0.00", side: "debit", entry_date: "2026-11-02" });
    expect(await balanceOf(db, a.businessId, store)).toBe("25.50");
  });

  it("works with invoices: a write-off settles the oldest unpaid invoice first", async () => {
    const store = await seedAccountStore(db, a, "Invoice write-off");
    const invoice = await issueInvoiceOf(db, a, store, "100.00");
    await dbAdjustmentAdd(db, a.userId, store, "100.00", "reduce", "Forgiven");
    const rows = await dbAllocation(db, a.userId, a.businessId, store);
    expect(rows.find((r) => r.invoice_id === invoice.id)).toMatchObject({ status: "paid", allocated: "100.00" });
  });
});

describe("refusals", () => {
  it("needs a reason of 1 to 500 characters", async () => {
    const store = await seedAccountStore(db, a, "Reason store");
    expect(await dbAdjustmentAdd(db, a.userId, store, "5.00", "reduce", null)).toMatchObject({ done: false, reason: "reason_required" });
    expect(await dbAdjustmentAdd(db, a.userId, store, "5.00", "reduce", "   ")).toMatchObject({ done: false, reason: "reason_required" });
    expect(await dbAdjustmentAdd(db, a.userId, store, "5.00", "reduce", "x".repeat(501))).toMatchObject({ done: false, reason: "reason_too_long" });
    expect((await dbAdjustmentAdd(db, a.userId, store, "5.00", "reduce", "x".repeat(500))).done).toBe(true);
    expect(await rawEntries(db, a.businessId, store)).toHaveLength(1);
  });

  it("refuses zero, negative, three decimals, too large, an unknown direction and a future date", async () => {
    const store = await seedAccountStore(db, a, "Amount store");
    for (const amount of ["0", "-5", "1.234", "10000000000.00", null]) {
      expect(await dbAdjustmentAdd(db, a.userId, store, amount, "reduce", "Reason"), String(amount)).toMatchObject({ done: false, reason: "invalid_amount" });
    }
    expect(await dbAdjustmentAdd(db, a.userId, store, "5.00", "add", "Reason")).toMatchObject({ done: false, reason: "invalid_direction" });
    expect(await dbAdjustmentAdd(db, a.userId, store, "5.00", "reduce", "Reason", { date: "2999-01-01" })).toMatchObject({ done: false, reason: "invalid_date" });
    expect(await dbAdjustmentAdd(db, a.userId, store, "5.00", "reduce", "Reason", { date: "1999-12-31" })).toMatchObject({ done: false, reason: "invalid_date" });
    expect(await rawEntries(db, a.businessId, store)).toEqual([]);
  });

  it("treats a store of another business like a missing one and leaves other stores unchanged", async () => {
    const storeB = await seedAccountStore(db, b, "Other business adj");
    expect(await dbAdjustmentAdd(db, a.userId, storeB, "5.00", "reduce", "Reason")).toMatchObject({ done: false, reason: "not_found" });
    const one = await seedAccountStore(db, a, "Adj one");
    const two = await seedAccountStore(db, a, "Adj two");
    await dbAdjustmentAdd(db, a.userId, one, "9.00", "increase", "Reason");
    expect(await balanceOf(db, a.businessId, two)).toBe("0.00");
  });
});

describe("exactly-once by the entry id", () => {
  it("records one entry for repeated requests and refuses the same id with other content", async () => {
    const store = await seedAccountStore(db, a, "Replay adj");
    const id = randomUUID();
    const first = await dbAdjustmentAdd(db, a.userId, store, "20.00", "reduce", "Forgiven", { id });
    const again = await dbAdjustmentAdd(db, a.userId, store, "20.00", "reduce", "Forgiven", { id });
    expect(first).toMatchObject({ done: true, replayed: false });
    expect(again).toMatchObject({ done: true, replayed: true });
    expect(await rawEntries(db, a.businessId, store)).toHaveLength(1);
    for (const attempt of [
      dbAdjustmentAdd(db, a.userId, store, "21.00", "reduce", "Forgiven", { id }),
      dbAdjustmentAdd(db, a.userId, store, "20.00", "increase", "Forgiven", { id }),
      dbAdjustmentAdd(db, a.userId, store, "20.00", "reduce", "Another reason", { id }),
    ]) {
      expect(await attempt).toMatchObject({ done: false, reason: "request_reused" });
    }
  });

  it("returns no forbidden key", async () => {
    const store = await seedAccountStore(db, a, "Adj no cost");
    const res = await dbAdjustmentAdd(db, a.userId, store, "3.00", "reduce", "Reason");
    expect(scanForbiddenKeys(res)).toEqual([]);
  });
});
