import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountArgs, draftInvoiceWithClient, scanForbiddenKeys, seedAccountStoreWithClient } from "../helpers/accounts";
import { anonClient, createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// Two real users on the Supabase test project: business B can never see or change business A's store accounts, even
// with crafted ids, and a refusal looks exactly like a missing record. Needs migration 0008 on the test project.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const TODAY = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

suite("store account isolation (real Supabase test project)", () => {
  let a: TestTenant;
  let b: TestTenant;
  let storeA: string;
  let storeB: string;
  let paymentA: string;
  let invoiceA: string;

  const rpc = async (tenant: TestTenant, fn: string, args: Record<string, unknown>) => {
    const res = await tenant.client.rpc(fn, args);
    if (res.error) throw new Error(`${fn}: ${res.error.message}`);
    return res.data;
  };

  beforeAll(async () => {
    a = await createTenant("accounts-rls-a");
    b = await createTenant("accounts-rls-b");
    storeA = await seedAccountStoreWithClient(a.client, "A store");
    storeB = await seedAccountStoreWithClient(b.client, "B store");
    await rpc(a, "ledger_opening_add", accountArgs.opening(randomUUID(), storeA, "700.00", "owes", "2026-10-01"));
    paymentA = (await rpc(a, "ledger_payment_add", accountArgs.payment(randomUUID(), storeA, "100.00", TODAY))).entry.id;
    const draft = await draftInvoiceWithClient(a.client, storeA, "300.00");
    invoiceA = draft.invoiceId;
    await rpc(a, "invoice_issue", accountArgs.issueWithPayment(draft.invoiceId, draft.version, null));
    await rpc(b, "ledger_opening_add", accountArgs.opening(randomUUID(), storeB, "50.00", "owes", "2026-10-01"));
  }, 240_000);

  afterAll(async () => {
    await deleteTenant(a);
    await deleteTenant(b);
  });

  it("B reads nothing of A through the read functions", async () => {
    const missing = randomUUID();
    expect(await rpc(b, "ledger_account", { p_store: storeA, p_limit: 20, p_offset: 0 })).toEqual({ found: false });
    expect(await rpc(b, "ledger_account", { p_store: missing, p_limit: 20, p_offset: 0 })).toEqual({ found: false });
    expect(await rpc(b, "ledger_payment_preview", { p_store: storeA, p_amount: "10.00" })).toEqual({ found: false });
    expect(await rpc(b, "ledger_statement", accountArgs.statement(storeA, "2026-10-01", TODAY))).toEqual({ found: false });
    const list = await rpc(b, "ledger_stores", { p_q: null, p_only_owing: false, p_limit: 50, p_offset: 0 });
    expect(list.items.map((row: { store_id: string }) => row.store_id)).toEqual([storeB]);
    expect(await rpc(b, "ledger_summary", {})).toMatchObject({ total_owed: "50.00", stores_owing: 1 });
    expect(await rpc(b, "invoice_get", { p_id: invoiceA })).toEqual({ found: false });
    expect(scanForbiddenKeys(list)).toEqual([]);
  }, 120_000);

  it("every write by B on A's store or entry answers exactly like a missing id and changes nothing", async () => {
    const missing = randomUUID();
    const foreign = [
      await rpc(b, "ledger_opening_add", accountArgs.opening(randomUUID(), storeA, "1.00", "owes", "2026-10-02")),
      await rpc(b, "ledger_payment_add", accountArgs.payment(randomUUID(), storeA, "1.00", TODAY)),
      await rpc(b, "ledger_adjustment_add", accountArgs.adjustment(randomUUID(), storeA, "1.00", "reduce", "x")),
      await rpc(b, "ledger_entry_reverse", accountArgs.reverse(randomUUID(), paymentA, "x")),
      await rpc(b, "invoice_cancel", { p_id: invoiceA, p_reason: "x" }),
    ];
    const absent = [
      await rpc(b, "ledger_opening_add", accountArgs.opening(randomUUID(), missing, "1.00", "owes", "2026-10-02")),
      await rpc(b, "ledger_payment_add", accountArgs.payment(randomUUID(), missing, "1.00", TODAY)),
      await rpc(b, "ledger_adjustment_add", accountArgs.adjustment(randomUUID(), missing, "1.00", "reduce", "x")),
      await rpc(b, "ledger_entry_reverse", accountArgs.reverse(randomUUID(), missing, "x")),
      await rpc(b, "invoice_cancel", { p_id: missing, p_reason: "x" }),
    ];
    expect(foreign).toEqual(absent);
    // A's account is untouched: 700 owed + 300 invoice - 100 paid
    expect((await rpc(a, "ledger_account", { p_store: storeA, p_limit: 20, p_offset: 0 })).balance).toBe("900.00");
    expect((await rpc(a, "ledger_account", { p_store: storeA, p_limit: 20, p_offset: 0 })).total_entries).toBe(3);
  }, 120_000);

  it("the same entry id used by both businesses stays separate", async () => {
    const sharedId = randomUUID();
    const first = await rpc(a, "ledger_payment_add", accountArgs.payment(sharedId, storeA, "5.00", TODAY));
    const second = await rpc(b, "ledger_payment_add", accountArgs.payment(sharedId, storeB, "7.00", TODAY));
    // The entry id is the primary key of the table, so one of the two is refused as a reused request id or the ids
    // are scoped per business; either way neither business sees the other's amount.
    expect(first.done).toBe(true);
    if (second.done === true) {
      expect(second.entry.credit).toBe("7.00");
      expect((await rpc(a, "ledger_account", { p_store: storeA, p_limit: 50, p_offset: 0 })).entries.find((e: { id: string }) => e.id === sharedId).credit).toBe("5.00");
    } else {
      expect(second.reason).toBe("request_reused");
    }
    const aEntry = (await rpc(a, "ledger_account", { p_store: storeA, p_limit: 50, p_offset: 0 })).entries.find((e: { id: string }) => e.id === sharedId);
    expect(aEntry.credit).toBe("5.00");
  }, 120_000);

  it("B sees no ledger rows in the table, and nobody can write the table directly", async () => {
    const seen = await b.client.from("ledger_entries").select("id, store_id");
    expect(seen.error).toBeNull();
    expect((seen.data ?? []).every((row) => row.id !== paymentA)).toBe(true);
    // only B's own rows (its opening balance and the shared-id payment of the previous test)
    expect((seen.data ?? []).length).toBeGreaterThan(0);
    expect((seen.data ?? []).every((row) => row.store_id === storeB)).toBe(true);

    const mine = await a.client.from("ledger_entries").select("id, entry_type").eq("store_id", storeA);
    const before = (mine.data ?? []).length;
    expect(before).toBeGreaterThanOrEqual(3);

    for (const tenant of [a, b]) {
      const inserted = await tenant.client.from("ledger_entries").insert({ id: randomUUID(), store_id: storeA, entry_type: "payment", credit: "1.00" });
      expect(inserted.error).not.toBeNull();
      await tenant.client.from("ledger_entries").update({ credit: "999.00" }).eq("id", paymentA);
      await tenant.client.from("ledger_entries").delete().eq("id", paymentA);
    }
    const after = await a.client.from("ledger_entries").select("id, credit").eq("store_id", storeA);
    expect((after.data ?? []).length).toBe(before);
    expect(Number((after.data ?? []).find((row) => row.id === paymentA)?.credit)).toBe(100);
  }, 120_000);

  it("the internal helpers are not callable by a signed-in user, whoever's business id is given", async () => {
    const businessA = a.businessId as string;
    const calls: Array<[string, Record<string, unknown>]> = [
      ["ledger_balances", { p_biz: businessA }],
      ["ledger_allocation", { p_biz: businessA, p_stores: [storeA], p_extra: 0 }],
      ["ledger_entry_json", { p_biz: businessA, p_id: paymentA }],
      [
        "ledger_insert_entry",
        { p_biz: businessA, p_store: storeA, p_id: randomUUID(), p_type: "payment", p_date: TODAY, p_debit: 0, p_credit: 1, p_invoice: null, p_reverses: null, p_method: "cash", p_reference: null, p_note: null },
      ],
    ];
    for (const [fn, args] of calls) {
      // B gets nothing of A's business: refused outright, or nothing comes back
      const asB = await b.client.rpc(fn, args);
      const empty = asB.data === null || (Array.isArray(asB.data) && asB.data.length === 0) || (typeof asB.data === "object" && asB.data !== null && Object.keys(asB.data).length === 0);
      expect(asB.error !== null || empty, `${fn} as B`).toBe(true);
    }
    // the write helper cannot be called by anybody, not even the owner of the business
    for (const tenant of [a, b]) {
      const res = await tenant.client.rpc("ledger_insert_entry", calls[3][1]);
      expect(res.error, `ledger_insert_entry as ${tenant === a ? "A" : "B"}`).not.toBeNull();
    }
    // nothing was written by the attempted insert
    const count = await a.client.from("ledger_entries").select("id").eq("store_id", storeA).eq("credit", 1);
    expect((count.data ?? []).length).toBe(0);
  }, 120_000);

  it("an anonymous client reads nothing and cannot call the ledger functions", async () => {
    const anon = anonClient();
    const table = await anon.from("ledger_entries").select("id");
    expect(table.error !== null || (table.data ?? []).length === 0).toBe(true);
    for (const [fn, args] of [
      ["ledger_stores", { p_q: null, p_only_owing: false, p_limit: 10, p_offset: 0 }],
      ["ledger_summary", {}],
      ["ledger_account", { p_store: storeA, p_limit: 10, p_offset: 0 }],
    ] as const) {
      const res = await anon.rpc(fn, args as Record<string, unknown>);
      expect(res.error, fn).not.toBeNull();
    }
  }, 120_000);
});
