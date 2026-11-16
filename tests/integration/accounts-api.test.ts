import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addOpeningBalance, getAccount, listAccounts } from "@/lib/accounts/repository";
import type { AccountView, LedgerEntry } from "@/lib/accounts/types";
import { ApiError } from "@/lib/api/errors";
import { todayInPakistan } from "@/lib/orders/dates";
import { AccountListQuerySchema, AccountQuerySchema, OpeningBalanceBodySchema } from "@/lib/validation/account";
import { scanForbiddenKeys, seedAccountStoreWithClient } from "../helpers/accounts";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// The store account repository functions against the real Supabase test project: round trips of every write and
// read of the store account, replay, the refusals, the balance equal to the sum of the entries, and no cost anywhere.
// Needs migration 0008 on the test project. (The payment, issue-with-payment and reversal round trips are added with
// their stories.)
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const TODAY = todayInPakistan();

/** The balance is the sum of the entries on its side (debits minus credits), in paisa. */
function sumOf(entries: LedgerEntry[]): number {
  return entries.reduce((total, e) => total + (e.side === "debit" ? 1 : -1) * Math.round(Number(e.amount) * 100), 0);
}

function asPaisa(balance: string): number {
  return Math.round(Number(balance) * 100);
}

async function fullAccount(tenant: TestTenant, storeId: string): Promise<AccountView> {
  const page = await getAccount(tenant.client, storeId, AccountQuerySchema.parse({ limit: "50" }));
  return page;
}

suite("store account round trips (Supabase test project)", () => {
  let a: TestTenant;
  let b: TestTenant;
  let store: string;

  beforeAll(async () => {
    a = await createTenant("accounts-api-a");
    b = await createTenant("accounts-api-b");
    store = await seedAccountStoreWithClient(a.client, "Nimer Medical");
  }, 120_000);

  afterAll(async () => {
    if (a) await deleteTenant(a);
    if (b) await deleteTenant(b);
  });

  it("starts with an empty account", async () => {
    const account = await fullAccount(a, store);
    expect(account.balance).toBe("0.00");
    expect(account.entries).toEqual([]);
    expect(account.total_entries).toBe(0);
    expect(account.store.name).toBe("Nimer Medical");
    expect(scanForbiddenKeys(account)).toEqual([]);
  });

  it("adds an opening balance in each direction and the balance equals the sum of the entries", async () => {
    const owes = await addOpeningBalance(a.client, store, OpeningBalanceBodySchema.parse({ id: randomUUID(), amount: "12000", direction: "owes", as_on: "2026-11-01", note: "From the paper khata" }));
    expect(owes.done).toBe(true);
    expect(owes.replayed).toBe(false);
    expect(owes.entry).toMatchObject({ entry_type: "opening_balance", debit: "12000.00", side: "debit", note: "From the paper khata", mine: true });
    const advance = await addOpeningBalance(a.client, store, OpeningBalanceBodySchema.parse({ id: randomUUID(), amount: "250.50", direction: "advance", as_on: TODAY }));
    expect(advance.entry).toMatchObject({ credit: "250.50", side: "credit" });

    const account = await fullAccount(a, store);
    expect(account.entries).toHaveLength(2);
    expect(account.balance).toBe("11749.50");
    expect(asPaisa(account.balance)).toBe(sumOf(account.entries));
    expect(account.owes).toBe(true);
    // the running balance of the newest entry is the balance
    expect(account.entries[0].running_balance).toBe(account.balance);
    expect(scanForbiddenKeys(owes)).toEqual([]);
    expect(scanForbiddenKeys(account)).toEqual([]);
  });

  it("returns the stored entry for the same id (replayed) and refuses the same id with other content", async () => {
    const id = randomUUID();
    const body = OpeningBalanceBodySchema.parse({ id, amount: "75", direction: "owes", as_on: "2026-11-02" });
    const store2 = await seedAccountStoreWithClient(a.client);
    const first = await addOpeningBalance(a.client, store2, body);
    const again = await addOpeningBalance(a.client, store2, body);
    expect(first.replayed).toBeFalsy();
    expect(again.replayed).toBe(true);
    expect(again.entry.id).toBe(first.entry.id);
    expect((await fullAccount(a, store2)).entries).toHaveLength(1);
    await expect(addOpeningBalance(a.client, store2, OpeningBalanceBodySchema.parse({ ...body, amount: "76" }))).rejects.toMatchObject({ code: "request_reused" });
  });

  it("refuses an amount the database does not accept, with the field named", async () => {
    // The route validates first; this proves the database also refuses a value that bypasses it.
    const bad = { id: randomUUID(), amount: "0.00", direction: "owes", as_on: "2026-11-01", note: null } as never;
    await expect(addOpeningBalance(a.client, store, bad)).rejects.toSatisfy((error: unknown) => error instanceof ApiError && error.code === "validation_error" && Boolean(error.fields?.amount));
    const future = { id: randomUUID(), amount: "5.00", direction: "owes", as_on: "2999-01-01", note: null } as never;
    await expect(addOpeningBalance(a.client, store, future)).rejects.toSatisfy((error: unknown) => error instanceof ApiError && error.code === "validation_error" && Boolean(error.fields?.date));
  });

  it("answers not_found for a store that does not exist", async () => {
    await expect(getAccount(a.client, randomUUID(), AccountQuerySchema.parse({}))).rejects.toMatchObject({ code: "not_found" });
    await expect(
      addOpeningBalance(a.client, randomUUID(), OpeningBalanceBodySchema.parse({ id: randomUUID(), amount: "5", direction: "owes", as_on: "2026-11-01" })),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("lists every store with its balance, stores that owe first, and filters", async () => {
    const list = await listAccounts(a.client, AccountListQuerySchema.parse({}));
    expect(list.total).toBeGreaterThanOrEqual(2);
    const nimer = list.items.find((row) => row.store_id === store);
    expect(nimer).toMatchObject({ name: "Nimer Medical", balance: "11749.50", owes: true, advance: false, entry_count: 2 });
    const balances = list.items.map((row) => asPaisa(row.balance));
    expect([...balances].sort((x, y) => y - x)).toEqual(balances);
    const owing = await listAccounts(a.client, AccountListQuerySchema.parse({ only_owing: "true" }));
    expect(owing.items.every((row) => row.owes)).toBe(true);
    const searched = await listAccounts(a.client, AccountListQuerySchema.parse({ q: "nimer" }));
    expect(searched.items.map((row) => row.store_id)).toEqual([store]);
    expect(scanForbiddenKeys(list)).toEqual([]);
  });

  it("does not show one business's store to the other", async () => {
    const other = await listAccounts(b.client, AccountListQuerySchema.parse({}));
    expect(other.items.find((row) => row.store_id === store)).toBeUndefined();
    await expect(getAccount(b.client, store, AccountQuerySchema.parse({}))).rejects.toMatchObject({ code: "not_found" });
  });
});
