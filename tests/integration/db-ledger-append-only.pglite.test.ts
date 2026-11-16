import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayInPakistan } from "../../src/lib/orders/dates";
import {
  countEntries,
  dbAdjustmentAdd,
  dbEntryReverse,
  dbOpeningAdd,
  dbPaymentAdd,
  issueInvoiceOf,
  rawEntries,
  seedAccountStore,
} from "../helpers/accounts-db";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";

// Entries are never edited or deleted (SC-006): every attempted update and delete is refused for a signed-in user,
// for the table owner and through every function. Only the service role may delete (removing a test business).

let db: PGlite;
let a: Tenant;
let store: string;
let entryIds: string[] = [];

const TODAY = todayInPakistan();

async function expectRefused(promise: Promise<unknown>, pattern?: RegExp): Promise<void> {
  await expect(promise).rejects.toThrow(pattern);
}

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "ledger-append-only");
  store = await seedAccountStore(db, a, "Append only store");
  // One entry of every type.
  const opening = await dbOpeningAdd(db, a.userId, store, "1000.00", "owes", "2026-11-01");
  const payment = await dbPaymentAdd(db, a.userId, store, "100.00", TODAY);
  const adjustment = await dbAdjustmentAdd(db, a.userId, store, "5.00", "reduce", "Small amount forgiven");
  const reversal = await dbEntryReverse(db, a.userId, payment.entry!.id, "Wrong store");
  const invoice = await issueInvoiceOf(db, a, store, "250.00");
  const entries = await rawEntries(db, a.businessId, store);
  entryIds = entries.map((e) => e.id);
  expect(entryIds).toEqual(expect.arrayContaining([opening.entry!.id, payment.entry!.id, adjustment.entry!.id, reversal.entry!.id]));
  expect(invoice.in_account).toBe(true);
  expect(entries.map((e) => e.entry_type).sort()).toEqual(["adjustment", "invoice", "opening_balance", "payment", "reversal"]);
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("the table owner cannot change or delete an entry", () => {
  it("refuses every update, column by column", async () => {
    for (const id of entryIds) {
      for (const set of ["note = 'edited'", "entry_date = '2026-01-01'", "store_id = store_id", "reference = 'x'", "created_by = null"]) {
        await expectRefused(db.query(`update public.ledger_entries set ${set} where id = $1`, [id]), /ledger_immutable/);
      }
    }
    await expectRefused(db.query(`update public.ledger_entries set debit = debit + 1 where entry_type = 'opening_balance'`), /ledger_immutable/);
    await expectRefused(db.query(`update public.ledger_entries set credit = 0`), /ledger_immutable/);
  });

  it("refuses every delete", async () => {
    for (const id of entryIds) {
      await expectRefused(db.query(`delete from public.ledger_entries where id = $1`, [id]), /ledger_immutable/);
    }
    await expectRefused(db.query(`delete from public.ledger_entries`), /ledger_immutable/);
    expect((await countEntries(db, a.businessId)) >= entryIds.length).toBe(true);
  });
});

describe("a signed-in user cannot change or delete an entry", () => {
  it("is refused with permission denied (no write grant)", async () => {
    await withRole(db, "authenticated", a.userId, async () => {
      await expectRefused(db.query(`update public.ledger_entries set note = 'edited'`), /permission denied/i);
      await expectRefused(db.query(`delete from public.ledger_entries`), /permission denied/i);
      await expectRefused(
        db.query(
          `insert into public.ledger_entries (id, store_id, entry_type, entry_date, debit) values ($1, $2, 'opening_balance', '2026-11-01', 5)`,
          [randomUUID(), store],
        ),
        /permission denied/i,
      );
      await expectRefused(
        db.query(`select public.ledger_insert_entry($1::uuid, $2::uuid, $3::uuid, 'opening_balance', '2026-11-01'::date, 5, 0, null, null, null, null, null)`, [
          a.businessId,
          store,
          randomUUID(),
        ]),
        /permission denied/i,
      );
    });
  });
});

describe("the service role may delete only to clean up a test business", () => {
  it("deletes an entry as the service role and nothing else changes", async () => {
    const other = await seedAccountStore(db, a, "Clean up store");
    const res = await dbOpeningAdd(db, a.userId, other, "5.00", "owes", "2026-11-01");
    const before = await countEntries(db, a.businessId);
    await db.exec(`grant all on public.ledger_entries to service_role`);
    await db.exec(`set role service_role`);
    try {
      await db.query(`delete from public.ledger_entries where id = $1`, [res.entry!.id]);
    } finally {
      await db.exec(`reset role`);
    }
    expect(await countEntries(db, a.businessId)).toBe(before - 1);
    // an update is still refused for the service role
    const again = await dbOpeningAdd(db, a.userId, other, "6.00", "owes", "2026-11-01");
    await db.exec(`grant all on public.ledger_entries to service_role`);
    await db.exec(`set role service_role`);
    try {
      await expectRefused(db.query(`update public.ledger_entries set note = 'x' where id = $1`, [again.entry!.id]), /ledger_immutable/);
    } finally {
      await db.exec(`reset role`);
    }
  });
});

describe("no function edits or deletes an entry", () => {
  it("leaves every existing entry byte for byte the same after more writes", async () => {
    const snapshot = JSON.stringify(await rawEntries(db, a.businessId, store));
    await dbPaymentAdd(db, a.userId, store, "10.00", TODAY);
    await dbAdjustmentAdd(db, a.userId, store, "1.00", "increase", "Rate difference");
    await dbOpeningAdd(db, a.userId, store, "3.00", "advance", "2026-11-03");
    const after = await rawEntries(db, a.businessId, store);
    const originalIds = new Set(entryIds);
    const kept = after.filter((e) => originalIds.has(e.id));
    expect(JSON.stringify(kept)).toBe(snapshot);
    expect(after.length).toBe(entryIds.length + 3);
  });
});
