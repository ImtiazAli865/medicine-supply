import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountArgs, draftInvoiceWithClient, seedAccountStoreWithClient } from "../helpers/accounts";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// Simultaneous requests through separate connections to the real Supabase test project (migration 0008 applied):
// the entry id as the request id, the partial unique indexes and the per-store lock are proven here, not only on one
// in-memory connection.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const TODAY = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

type Entry = { id: string; entry_type: string; debit: string; credit: string };
type Result = Record<string, unknown> & { done?: boolean; replayed?: boolean; reason?: string };

suite("store accounts under simultaneous requests", () => {
  let a: TestTenant;
  let client: SupabaseClient;

  const entries = async (storeId: string): Promise<Entry[]> => {
    const res = await client.from("ledger_entries").select("id, entry_type, debit, credit").eq("store_id", storeId);
    if (res.error) throw new Error(res.error.message);
    return (res.data ?? []) as Entry[];
  };
  const balance = async (storeId: string): Promise<string> => {
    const res = await client.rpc("ledger_account", { p_store: storeId, p_limit: 1, p_offset: 0 });
    if (res.error || res.data?.found !== true) throw new Error(`ledger_account: ${res.error?.message}`);
    return res.data.balance as string;
  };
  const rpc = async (name: string, args: Record<string, unknown>): Promise<Result> => {
    const res = await client.rpc(name, args);
    if (res.error) throw new Error(`${name}: ${res.error.message}`);
    return res.data as Result;
  };

  beforeAll(async () => {
    a = await createTenant("accounts-conc");
    client = a.client;
  }, 120_000);

  afterAll(async () => {
    await deleteTenant(a);
  });

  // ---- part 1: invoices enter the account once ----

  it("gives 10 simultaneous issues of one draft one invoice entry", async () => {
    const store = await seedAccountStoreWithClient(client);
    const draft = await draftInvoiceWithClient(client, store, "1000.00");
    const results = await Promise.all(Array.from({ length: 10 }, () => rpc("invoice_issue", accountArgs.issueWithPayment(draft.invoiceId, draft.version, null))));
    expect(results.every((r) => r.done === true)).toBe(true);
    expect(results.filter((r) => r.replayed === false)).toHaveLength(1);
    const rows = await entries(store);
    expect(rows.filter((e) => e.entry_type === "invoice")).toHaveLength(1);
    expect(await balance(store)).toBe("1000.00");
  }, 120_000);

  it("gives 10 different drafts of one store issued at once 10 entries and the sum as the balance", async () => {
    const store = await seedAccountStoreWithClient(client);
    const drafts = [];
    for (let i = 1; i <= 10; i += 1) drafts.push(await draftInvoiceWithClient(client, store, `${i * 100}.00`));
    const results = await Promise.all(drafts.map((d) => rpc("invoice_issue", accountArgs.issueWithPayment(d.invoiceId, d.version, null))));
    expect(results.every((r) => r.done === true)).toBe(true);
    expect((await entries(store)).filter((e) => e.entry_type === "invoice")).toHaveLength(10);
    expect(await balance(store)).toBe("5500.00");
  }, 240_000);

  it("gives 10 simultaneous cancels of one invoice one reversal", async () => {
    const store = await seedAccountStoreWithClient(client);
    const draft = await draftInvoiceWithClient(client, store, "400.00");
    await rpc("invoice_issue", accountArgs.issueWithPayment(draft.invoiceId, draft.version, null));
    const results = await Promise.all(Array.from({ length: 10 }, () => rpc("invoice_cancel", { p_id: draft.invoiceId, p_reason: "Wrong quantities" })));
    expect(results.every((r) => r.done === true)).toBe(true);
    expect((await entries(store)).filter((e) => e.entry_type === "reversal")).toHaveLength(1);
    expect(await balance(store)).toBe("0.00");
  }, 120_000);

  // ---- part 2: payments ----

  it("gives 10 simultaneous identical payments (same id) one entry", async () => {
    const store = await seedAccountStoreWithClient(client);
    const id = randomUUID();
    const results = await Promise.all(Array.from({ length: 10 }, () => rpc("ledger_payment_add", accountArgs.payment(id, store, "250.00", TODAY))));
    expect(results.every((r) => r.done === true)).toBe(true);
    expect(results.filter((r) => r.replayed === false)).toHaveLength(1);
    expect(results.filter((r) => r.replayed === true)).toHaveLength(9);
    expect((await entries(store)).filter((e) => e.entry_type === "payment")).toHaveLength(1);
    expect(await balance(store)).toBe("-250.00");
  }, 120_000);

  it("records 10 simultaneous payments with different ids as 10 entries and the exact balance", async () => {
    const store = await seedAccountStoreWithClient(client);
    await rpc("ledger_opening_add", accountArgs.opening(randomUUID(), store, "1000.00", "owes", "2026-10-01"));
    const results = await Promise.all(Array.from({ length: 10 }, () => rpc("ledger_payment_add", accountArgs.payment(randomUUID(), store, "50.00", TODAY))));
    expect(results.every((r) => r.done === true)).toBe(true);
    expect((await entries(store)).filter((e) => e.entry_type === "payment")).toHaveLength(10);
    expect(await balance(store)).toBe("500.00");
  }, 120_000);

  it("gives 10 simultaneous reversals of one payment one reversal and refuses the rest", async () => {
    const store = await seedAccountStoreWithClient(client);
    const paid = await rpc("ledger_payment_add", accountArgs.payment(randomUUID(), store, "300.00", TODAY));
    const entryId = (paid.entry as { id: string }).id;
    const results = await Promise.all(Array.from({ length: 10 }, () => rpc("ledger_entry_reverse", accountArgs.reverse(randomUUID(), entryId, "Entered twice"))));
    expect(results.filter((r) => r.done === true)).toHaveLength(1);
    expect(results.filter((r) => r.done === false).every((r) => r.reason === "already_reversed")).toBe(true);
    expect((await entries(store)).filter((e) => e.entry_type === "reversal")).toHaveLength(1);
    expect(await balance(store)).toBe("0.00");
  }, 120_000);

  it("never lets a payment of one store change another store", async () => {
    const one = await seedAccountStoreWithClient(client);
    const two = await seedAccountStoreWithClient(client);
    await Promise.all([
      ...Array.from({ length: 5 }, () => rpc("ledger_payment_add", accountArgs.payment(randomUUID(), one, "10.00", TODAY))),
      ...Array.from({ length: 5 }, () => rpc("ledger_opening_add", accountArgs.opening(randomUUID(), two, "20.00", "owes", "2026-10-01"))),
    ]);
    expect(await balance(one)).toBe("-50.00");
    expect(await balance(two)).toBe("100.00");
  }, 120_000);

  // ---- part 3: issue with a payment ----

  it("gives 10 simultaneous issues of one draft with a payment one invoice, one invoice entry and one payment", async () => {
    const store = await seedAccountStoreWithClient(client);
    const draft = await draftInvoiceWithClient(client, store, "900.00");
    const results = await Promise.all(Array.from({ length: 10 }, () => rpc("invoice_issue", accountArgs.issueWithPayment(draft.invoiceId, draft.version, "400.00"))));
    expect(results.every((r) => r.done === true)).toBe(true);
    const rows = await entries(store);
    expect(rows.filter((e) => e.entry_type === "invoice")).toHaveLength(1);
    expect(rows.filter((e) => e.entry_type === "payment")).toHaveLength(1);
    expect(await balance(store)).toBe("500.00");
  }, 120_000);

  it("adds no entry when the payment is invalid, and the draft can still be issued afterwards", async () => {
    const store = await seedAccountStoreWithClient(client);
    const draft = await draftInvoiceWithClient(client, store, "100.00");
    const refused = await rpc("invoice_issue", accountArgs.issueWithPayment(draft.invoiceId, draft.version, "12.345"));
    expect(refused.done).toBe(false);
    expect(await entries(store)).toHaveLength(0);
    const good = await rpc("invoice_issue", accountArgs.issueWithPayment(draft.invoiceId, draft.version, null));
    expect(good.done).toBe(true);
    expect(await balance(store)).toBe("100.00");
  }, 120_000);
});
