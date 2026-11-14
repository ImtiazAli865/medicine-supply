import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMarketList, getMarketSummary, getCompleteMarketList } from "@/lib/market/repository";
import { ListQuerySchema } from "@/lib/validation/market";
import { addDays, moneyKeys, pkt, seedConfirmedWithClient, todayPkt } from "../helpers/market";
import { seedMedicineWithClient, seedStoreWithClient } from "../helpers/pending";
import { anonClient, createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// The market list repository (the code behind GET /api/market-list and /api/market-list/summary) against a real
// Supabase test project, signed in as real users so Row Level Security and the database functions are in effect.
// Skipped without credentials.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const DAY = addDays(todayPkt(), -1); // a past Pakistan day, so a purchase may be recorded for it
const query = (extra: Record<string, string> = {}) => ListQuerySchema().parse({ date: DAY, ...extra });

suite("market list repository against Supabase", () => {
  let a: TestTenant;
  let b: TestTenant;
  let panadol: string;
  let brufen: string;

  beforeAll(async () => {
    a = await createTenant("market-a");
    b = await createTenant("market-b");
    const s1 = await seedStoreWithClient(a.client, "Al Madina");
    const s2 = await seedStoreWithClient(a.client, "Shah Medical");
    panadol = await seedMedicineWithClient(a.client, { name: "Panadol", unit: "strip", purchase_price: "90.00", selling_price: "125.50", mrp: "130.00" });
    brufen = await seedMedicineWithClient(a.client, { name: "Brufen", unit: "strip", purchase_price: "70.00", selling_price: "99.00" });
    await seedConfirmedWithClient(a.client, s1, [{ product_id: panadol, quantity: 20 }, { product_id: null, name: "Noran 20mg cap", quantity: 4 }], pkt(DAY, "10:00"));
    await seedConfirmedWithClient(a.client, s2, [{ product_id: panadol, quantity: 10 }, { product_id: brufen, quantity: 5 }, { product_id: null, name: "noran  20MG cap", quantity: 6 }], pkt(DAY, "11:00"));
    // a draft that must never count
    const { seedOrderWithClient } = await import("../helpers/pending");
    await seedOrderWithClient(a.client, s2, [{ product_id: panadol, quantity: 99 }]);
    await seedStoreWithClient(b.client, "B Pharmacy");
  }, 120_000);

  afterAll(async () => {
    await deleteTenant(a);
    await deleteTenant(b);
  });

  it("adds the day's confirmed orders by medicine with each store's share, typed lines in their own group, and ignores the draft", async () => {
    const list = await getMarketList(a.client, query());
    expect(list.date).toBe(DAY);
    const panadolRow = list.rows.find((r) => r.name === "Panadol")!;
    expect(panadolRow).toMatchObject({ total_requested: 30, purchased: 0, remaining: 30, status: "not_bought", can_record: true });
    expect(panadolRow.stores.map((s) => [s.store_name, s.quantity])).toEqual([["Al Madina", 20], ["Shah Medical", 10]]);
    expect(list.rows.find((r) => r.name === "Brufen")?.total_requested).toBe(5);
    expect(list.typed_rows).toHaveLength(1);
    expect(list.typed_rows[0]).toMatchObject({ total_requested: 10, can_record: false, status: "not_bought" });
    expect(list.stores.map((s) => s.name)).toEqual(["Al Madina", "Shah Medical"]);
    expect(list.truncated).toBe(false);
  });

  it("keeps the sum rule: all list quantities equal the confirmed order line quantities of the day", async () => {
    const list = await getMarketList(a.client, query());
    const listed = [...list.rows, ...list.typed_rows].reduce((sum, r) => sum + r.total_requested, 0);
    expect(listed).toBe(20 + 4 + 10 + 5 + 6);
    expect(list.totals.requested).toBe(listed);
  });

  it("has no price, cost or MRP key or value anywhere in the list or the summary", async () => {
    const list = await getMarketList(a.client, query());
    const summary = await getMarketSummary(a.client, DAY);
    expect(moneyKeys(list)).toEqual([]);
    expect(moneyKeys(summary)).toEqual([]);
    const text = JSON.stringify([list, summary]);
    for (const value of ["90.00", "125.50", "130.00", "70.00", "99.00"]) expect(text, value).not.toContain(value);
  });

  it("gives a summary that equals the still-to-buy list", async () => {
    const summary = await getMarketSummary(a.client, DAY);
    const toBuy = await getMarketList(a.client, query({ status: "to_buy" }));
    expect(summary.rows_to_buy).toBe(toBuy.rows.length + toBuy.typed_rows.length);
    expect(summary).toMatchObject({ date: DAY, rows_total: 3, typed_rows: 1, rows_to_buy: 3 });
  });

  it("returns an empty list for a day without orders", async () => {
    const list = await getMarketList(a.client, ListQuerySchema().parse({ date: "2026-01-01" }));
    expect(list).toMatchObject({ rows: [], typed_rows: [], stores: [], truncated: false });
  });

  it("filters by search, status and store through the same call", async () => {
    expect((await getMarketList(a.client, query({ q: "panad" }))).rows.map((r) => r.name)).toEqual(["Panadol"]);
    const stores = (await getMarketList(a.client, query())).stores;
    const shah = stores.find((s) => s.name === "Shah Medical")!;
    const only = await getMarketList(a.client, query({ stores: shah.id }));
    expect(only.rows.find((r) => r.name === "Panadol")).toMatchObject({ shown_requested: 10, total_requested: 30 });
  });

  it("returns the complete list for print and export (not cut short)", async () => {
    const list = await getCompleteMarketList(a.client, query());
    expect(list.truncated).toBe(false);
  });

  it("refuses bad input before it reaches the database", () => {
    expect(ListQuerySchema().safeParse({ date: "2026-02-30" }).success).toBe(false);
    expect(ListQuerySchema().safeParse({ status: "done" }).success).toBe(false);
    expect(ListQuerySchema().safeParse({ stores: "not-a-uuid" }).success).toBe(false);
  });

  it("shows another business nothing of this business", async () => {
    const list = await getMarketList(b.client, query());
    expect(list).toMatchObject({ rows: [], typed_rows: [], stores: [] });
  });

  it("refuses an anonymous caller", async () => {
    const res = await anonClient().rpc("market_list", { p_date: DAY, p_q: null, p_status: "all", p_stores: null });
    expect(res.error).not.toBeNull();
    const summary = await anonClient().rpc("market_summary", { p_date: DAY });
    expect(summary.error).not.toBeNull();
  });
});
