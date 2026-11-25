import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAccount, recordPayment } from "@/lib/accounts/repository";
import type { AccountView, LedgerEntry } from "@/lib/accounts/types";
import { todayInPakistan } from "@/lib/orders/dates";
import { AccountQuerySchema, PaymentBodySchema } from "@/lib/validation/account";
import { issueInvoiceWithClient, seedAccountStoreWithClient } from "../helpers/accounts";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// The server side of payments sent from the phone's queue (Module 011): what the payment route does with a payment that arrives
// late, twice, for a store that is not there, or with details it refuses. It calls the same function the route calls
// (`recordPayment`, after the same body check), against the real Supabase test project. The route itself and the phone's
// transport are covered by the browser tests of the queue. Needs migration 0008 on the test project.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const TODAY = todayInPakistan();

function paisa(amount: string): number {
  return Math.round(Number(amount) * 100);
}

function sumOf(entries: LedgerEntry[]): number {
  return entries.reduce((total, e) => total + (e.side === "debit" ? 1 : -1) * paisa(e.amount), 0);
}

async function accountOf(tenant: TestTenant, storeId: string): Promise<AccountView> {
  return getAccount(tenant.client, storeId, AccountQuerySchema.parse({ limit: "50" }));
}

function body(id: string, amount: string, date = TODAY, reference: string | null = null) {
  return PaymentBodySchema.parse({ id, amount, date, method: "cash", reference });
}

suite("payments sent from the phone (Supabase test project)", () => {
  let a: TestTenant;
  let b: TestTenant;
  let store: string;

  beforeAll(async () => {
    a = await createTenant("payments-queue-a");
    b = await createTenant("payments-queue-b");
    store = await seedAccountStoreWithClient(a.client, "Queue Medical");
  }, 120_000);

  afterAll(async () => {
    if (a) await deleteTenant(a);
    if (b) await deleteTenant(b);
  });

  it("records a payment once, and the same key again returns the stored entry with the ledger still holding one", async () => {
    const id = randomUUID();
    const first = await recordPayment(a.client, store, body(id, "5000", TODAY, "R1"));
    expect(first.done).toBe(true);
    expect(first.replayed).toBe(false);
    expect(first.entry).toMatchObject({ entry_type: "payment", credit: "5000.00", side: "credit" });
    const again = await recordPayment(a.client, store, body(id, "5000", TODAY, "R1"));
    expect(again.done).toBe(true);
    expect(again.replayed).toBe(true);
    expect(again.entry.id).toBe(first.entry.id);
    const account = await accountOf(a, store);
    expect(account.entries.filter((e) => e.entry_type === "payment")).toHaveLength(1);
    expect(paisa(account.balance)).toBe(sumOf(account.entries));
  });

  it("refuses the same key with another amount or date as request_reused, and records nothing", async () => {
    const id = randomUUID();
    await recordPayment(a.client, store, body(id, "100", TODAY, "R2"));
    const before = (await accountOf(a, store)).total_entries;
    for (const other of [body(id, "101", TODAY, "R2"), body(id, "100", "2026-11-01", "R2")]) {
      await expect(recordPayment(a.client, store, other)).rejects.toMatchObject({ code: "request_reused" });
    }
    expect((await accountOf(a, store)).total_entries).toBe(before);
  });

  it("treats the same key with only another reference as a repeat and keeps the reference the server first saved", async () => {
    // The reference is a note, not part of what makes a payment the same payment (Module 007). The phone never changes the details
    // of a payment it has sent; it changes them only after a refusal, when nothing was recorded.
    const id = randomUUID();
    await recordPayment(a.client, store, body(id, "100", TODAY, "first"));
    const again = await recordPayment(a.client, store, body(id, "100", TODAY, "second"));
    expect(again.replayed).toBe(true);
    expect(again.entry.reference).toBe("first");
  });

  it("answers not_found, the same way, for a store of another business and for a store that does not exist", async () => {
    const foreign = await seedAccountStoreWithClient(b.client, "Not Yours");
    const results: unknown[] = [];
    for (const target of [foreign, randomUUID()]) {
      try {
        await recordPayment(a.client, target, body(randomUUID(), "10"));
        results.push("recorded");
      } catch (error) {
        results.push({ code: (error as { code?: string }).code, message: (error as Error).message });
      }
    }
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ code: "not_found" });
    // nothing was applied to the other business's store
    expect((await accountOf(b, foreign)).total_entries).toBe(0);
  });

  it("refuses an amount of 0 and of 0.001, and a date in the future, and records nothing", async () => {
    const before = (await accountOf(a, store)).total_entries;
    for (const amount of ["0", "0.001", "-5"]) {
      expect(PaymentBodySchema.safeParse({ id: randomUUID(), amount, date: TODAY, method: "cash", reference: null }).success, amount).toBe(false);
    }
    const parsed = PaymentBodySchema.safeParse({ id: randomUUID(), amount: "10", date: "2999-01-01", method: "cash", reference: null });
    if (parsed.success) {
      await expect(recordPayment(a.client, store, parsed.data)).rejects.toMatchObject({ code: "validation_error", fields: { date: expect.any(String) } });
    }
    const early = PaymentBodySchema.safeParse({ id: randomUUID(), amount: "10", date: "1999-12-31", method: "cash", reference: null });
    if (early.success) {
      await expect(recordPayment(a.client, store, early.data)).rejects.toMatchObject({ code: "validation_error", fields: { date: expect.any(String) } });
    }
    expect((await accountOf(a, store)).total_entries).toBe(before);
  });

  it("sends three payments for one store in order: the balance is the sum of the entries, oldest unpaid first, an advance is kept", async () => {
    const own = await seedAccountStoreWithClient(a.client, "Allocation Medical");
    await issueInvoiceWithClient(a.client, own, "1000.00");
    await issueInvoiceWithClient(a.client, own, "2000.00");
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    // 600 settles part of the first invoice, 2000 settles the rest of the first and part of the second, 1000 pays the second and leaves 100 as an advance... of nothing
    await recordPayment(a.client, own, body(ids[0]!, "600"));
    await recordPayment(a.client, own, body(ids[1]!, "2000"));
    let account = await accountOf(a, own);
    expect(account.balance).toBe("400.00");
    expect(account.open_items).toHaveLength(1);
    expect(account.open_items[0]).toMatchObject({ outstanding: "400.00" });
    await recordPayment(a.client, own, body(ids[2]!, "1000"));
    account = await accountOf(a, own);
    expect(account.balance).toBe("-600.00"); // 3000 owed, 3600 paid: 600 kept as an advance
    expect(account.open_items).toHaveLength(0);
    expect(paisa(account.balance)).toBe(sumOf(account.entries));
    // sending all three again (a repeat of the whole queue) changes nothing
    for (const [i, amount] of [["0", "600"], ["1", "2000"], ["2", "1000"]] as const) {
      const replay = await recordPayment(a.client, own, body(ids[Number(i)]!, amount));
      expect(replay.replayed).toBe(true);
    }
    const after = await accountOf(a, own);
    expect(after.balance).toBe("-600.00");
    expect(after.total_entries).toBe(account.total_entries);
  });
});
