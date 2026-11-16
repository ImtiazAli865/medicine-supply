import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayInPakistan } from "../../src/lib/orders/dates";
import {
  balanceOf,
  countEntries,
  dbAccount,
  dbEntryReverse,
  dbOpeningAdd,
  dbStores,
  rawEntries,
  seedAccountStore,
} from "../helpers/accounts-db";
import { scanForbiddenKeys } from "../helpers/invoices";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// The opening balance (User Story 1) on a real PostgreSQL engine: either direction, any past day, the refusals,
// exactly-once by the entry id, and isolation between stores and businesses.

let db: PGlite;
let a: Tenant;
let b: Tenant;
let storeA: string;
let storeA2: string;
let storeB: string;

const TODAY = todayInPakistan();

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "ledger-opening-a");
  b = await createTenant(db, "ledger-opening-b");
  storeA = await seedAccountStore(db, a, "Nimer");
  storeA2 = await seedAccountStore(db, a, "Al Shifa");
  storeB = await seedAccountStore(db, b, "Other business store");
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("an empty account", () => {
  it("has balance 0.00 and no entries", async () => {
    const res = await dbAccount(db, a.userId, storeA);
    expect(res.found).toBe(true);
    if (!res.found) return;
    expect(res.balance).toBe("0.00");
    expect(res.owes).toBe(false);
    expect(res.advance).toBe(false);
    expect(res.entries).toEqual([]);
    expect(res.total_entries).toBe(0);
    expect(res.open_items).toEqual([]);
  });
});

describe("adding an opening balance", () => {
  it("adds one debit entry when the store owes, with its date, who and when", async () => {
    const id = randomUUID();
    const res = await dbOpeningAdd(db, a.userId, storeA, "12000.00", "owes", "2026-11-01", "From the paper khata", id);
    expect(res.done).toBe(true);
    expect(res.replayed).toBe(false);
    expect(res.entry).toMatchObject({
      id,
      entry_type: "opening_balance",
      entry_date: "2026-11-01",
      debit: "12000.00",
      credit: "0.00",
      side: "debit",
      amount: "12000.00",
      note: "From the paper khata",
      reversed: false,
      mine: true,
    });
    expect(res.entry?.created_at).toBeTruthy();
    const account = await dbAccount(db, a.userId, storeA);
    if (!account.found) throw new Error("account not found");
    expect(account.balance).toBe("12000.00");
    expect(account.owes).toBe(true);
    expect(account.entries.length).toBe(1);
    expect(account.entries[0].running_balance).toBe("12000.00");
    expect(account.open_items).toHaveLength(1);
    expect(account.open_items[0]).toMatchObject({ kind: "opening_balance", amount: "12000.00", outstanding: "12000.00", status: "unpaid" });
  });

  it("adds a credit entry when the store paid in advance, and the balance is negative", async () => {
    const res = await dbOpeningAdd(db, a.userId, storeA2, "700.50", "advance", "2026-10-15");
    expect(res.done).toBe(true);
    expect(res.entry).toMatchObject({ debit: "0.00", credit: "700.50", side: "credit" });
    const account = await dbAccount(db, a.userId, storeA2);
    if (!account.found) throw new Error("account not found");
    expect(account.balance).toBe("-700.50");
    expect(account.advance).toBe(true);
    expect(account.owes).toBe(false);
    expect(account.open_items).toEqual([]);
  });

  it("keeps several opening balances for one store as separate entries", async () => {
    const store = await seedAccountStore(db, a, "Several openings");
    expect((await dbOpeningAdd(db, a.userId, store, "100.00", "owes", "2026-11-01")).done).toBe(true);
    expect((await dbOpeningAdd(db, a.userId, store, "50.00", "owes", TODAY)).done).toBe(true);
    expect((await dbOpeningAdd(db, a.userId, store, "30.00", "advance", "2026-11-02")).done).toBe(true);
    const account = await dbAccount(db, a.userId, store);
    if (!account.found) throw new Error("account not found");
    expect(account.entries).toHaveLength(3);
    expect(account.balance).toBe("120.00");
    expect(await balanceOf(db, a.businessId, store)).toBe("120.00");
  });

  it("accepts any past day, including after invoices and payments exist, and refuses the future", async () => {
    const store = await seedAccountStore(db, a, "Any day");
    expect((await dbOpeningAdd(db, a.userId, store, "10.00", "owes", "2000-01-01")).done).toBe(true);
    expect((await dbOpeningAdd(db, a.userId, store, "10.00", "owes", TODAY)).done).toBe(true);
    const future = await dbOpeningAdd(db, a.userId, store, "10.00", "owes", "2999-01-01");
    expect(future).toMatchObject({ done: false, reason: "invalid_date" });
    const tooOld = await dbOpeningAdd(db, a.userId, store, "10.00", "owes", "1999-12-31");
    expect(tooOld).toMatchObject({ done: false, reason: "invalid_date" });
    const noDate = await dbOpeningAdd(db, a.userId, store, "10.00", "owes", null as unknown as string);
    expect(noDate).toMatchObject({ done: false, reason: "invalid_date" });
  });
});

describe("refusals", () => {
  it("refuses zero, negative, three decimals, too large and a missing amount, and records nothing", async () => {
    const store = await seedAccountStore(db, a, "Refusals");
    for (const amount of ["0", "0.00", "-5.00", "1.234", "10000000000.00", null]) {
      const res = await dbOpeningAdd(db, a.userId, store, amount, "owes", "2026-11-01");
      expect(res, String(amount)).toMatchObject({ done: false, reason: "invalid_amount" });
    }
    expect(await rawEntries(db, a.businessId, store)).toEqual([]);
  });

  it("accepts the largest amount", async () => {
    const store = await seedAccountStore(db, a, "Largest");
    const res = await dbOpeningAdd(db, a.userId, store, "9999999999.99", "owes", "2026-11-01");
    expect(res.done).toBe(true);
    expect(await balanceOf(db, a.businessId, store)).toBe("9999999999.99");
  });

  it("refuses an unknown direction and a note above 200 characters", async () => {
    const store = await seedAccountStore(db, a, "Direction");
    expect(await dbOpeningAdd(db, a.userId, store, "5.00", "debit", "2026-11-01")).toMatchObject({ done: false, reason: "invalid_direction" });
    expect(await dbOpeningAdd(db, a.userId, store, "5.00", "owes", "2026-11-01", "x".repeat(201))).toMatchObject({
      done: false,
      reason: "note_too_long",
    });
    expect((await dbOpeningAdd(db, a.userId, store, "5.00", "owes", "2026-11-01", "x".repeat(200))).done).toBe(true);
  });

  it("treats a store of another business like a missing one", async () => {
    const before = await countEntries(db, b.businessId);
    const res = await dbOpeningAdd(db, a.userId, storeB, "100.00", "owes", "2026-11-01");
    expect(res).toMatchObject({ done: false, reason: "not_found" });
    expect(await countEntries(db, b.businessId)).toBe(before);
    expect(await dbAccount(db, a.userId, storeB)).toEqual({ found: false });
    expect(await dbOpeningAdd(db, a.userId, randomUUID(), "100.00", "owes", "2026-11-01")).toMatchObject({ done: false, reason: "not_found" });
  });
});

describe("exactly-once by the entry id", () => {
  it("returns the stored entry for the same id and content (replayed) and records one entry", async () => {
    const store = await seedAccountStore(db, a, "Replay");
    const id = randomUUID();
    const first = await dbOpeningAdd(db, a.userId, store, "250.00", "owes", "2026-11-01", null, id);
    const second = await dbOpeningAdd(db, a.userId, store, "250.00", "owes", "2026-11-01", null, id);
    expect(first).toMatchObject({ done: true, replayed: false });
    expect(second).toMatchObject({ done: true, replayed: true });
    expect(second.entry?.id).toBe(id);
    expect(await rawEntries(db, a.businessId, store)).toHaveLength(1);
    expect(await balanceOf(db, a.businessId, store)).toBe("250.00");
  });

  it("refuses the same id with a different amount, store, direction or date", async () => {
    const store = await seedAccountStore(db, a, "Reused");
    const other = await seedAccountStore(db, a, "Reused other");
    const id = randomUUID();
    await dbOpeningAdd(db, a.userId, store, "250.00", "owes", "2026-11-01", null, id);
    for (const attempt of [
      dbOpeningAdd(db, a.userId, store, "251.00", "owes", "2026-11-01", null, id),
      dbOpeningAdd(db, a.userId, other, "250.00", "owes", "2026-11-01", null, id),
      dbOpeningAdd(db, a.userId, store, "250.00", "advance", "2026-11-01", null, id),
      dbOpeningAdd(db, a.userId, store, "250.00", "owes", "2026-11-02", null, id),
    ]) {
      expect(await attempt).toMatchObject({ done: false, reason: "request_reused" });
    }
    expect(await rawEntries(db, a.businessId, store)).toHaveLength(1);
    expect(await rawEntries(db, a.businessId, other)).toHaveLength(0);
  });

  it("lets two businesses use the same entry id without colliding", async () => {
    const id = randomUUID();
    const one = await dbOpeningAdd(db, a.userId, storeA2, "5.00", "owes", "2026-11-01", null, id);
    const two = await dbOpeningAdd(db, b.userId, storeB, "7.00", "owes", "2026-11-01", null, id);
    expect(one.done).toBe(true);
    expect(two.done).toBe(true);
    expect((await dbAccount(db, b.userId, storeB)).found).toBe(true);
  });
});

describe("isolation between stores", () => {
  it("leaves every other store unchanged", async () => {
    const x = await seedAccountStore(db, a, "Store X");
    const y = await seedAccountStore(db, a, "Store Y");
    await dbOpeningAdd(db, a.userId, x, "999.00", "owes", "2026-11-01");
    expect(await balanceOf(db, a.businessId, y)).toBe("0.00");
    const list = await dbStores(db, a.userId, { limit: 50 });
    const rowY = list.items.find((r) => r.store_id === y);
    expect(rowY).toMatchObject({ balance: "0.00", entry_count: 0, owes: false, advance: false });
    const rowX = list.items.find((r) => r.store_id === x);
    expect(rowX).toMatchObject({ balance: "999.00", entry_count: 1, owes: true });
  });
});

describe("a wrong opening balance", () => {
  it("is corrected by a reversal, never edited, and the original stays visible", async () => {
    const store = await seedAccountStore(db, a, "Wrong opening");
    const opening = await dbOpeningAdd(db, a.userId, store, "12000.00", "owes", "2026-11-01");
    const id = opening.entry!.id;
    const reversal = await dbEntryReverse(db, a.userId, id, "Typed the wrong store");
    expect(reversal.done).toBe(true);
    expect(reversal.entry).toMatchObject({ entry_type: "reversal", credit: "12000.00", debit: "0.00", note: "Typed the wrong store" });
    const account = await dbAccount(db, a.userId, store);
    if (!account.found) throw new Error("account not found");
    expect(account.balance).toBe("0.00");
    expect(account.entries).toHaveLength(2);
    expect(account.entries.find((e) => e.id === id)).toMatchObject({ reversed: true, reversed_by_entry_id: reversal.entry!.id });
    expect(account.open_items).toEqual([]);
  });
});

describe("no cost anywhere", () => {
  it("returns no forbidden key", async () => {
    const store = await seedAccountStore(db, a, "No cost");
    const res = await dbOpeningAdd(db, a.userId, store, "5.00", "owes", "2026-11-01");
    expect(scanForbiddenKeys(res)).toEqual([]);
    expect(scanForbiddenKeys(await dbAccount(db, a.userId, store))).toEqual([]);
    expect(scanForbiddenKeys(await dbStores(db, a.userId))).toEqual([]);
  });
});
