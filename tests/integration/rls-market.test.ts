import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMarketList, recordPurchase, voidPurchase } from "@/lib/market/repository";
import { ListQuerySchema, RecordPurchaseBodySchema, VoidPurchaseBodySchema } from "@/lib/validation/market";
import { addDays, pkt, recordArgs, recordBody, seedConfirmedWithClient, todayPkt } from "../helpers/market";
import { seedMedicineWithClient, seedStoreWithClient } from "../helpers/pending";
import { anonClient, createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// Two real users of two businesses on the Supabase test project (PostgREST, the real role setup): business B can
// never read or change business A's list, purchases or cancellations, even with crafted ids. Skipped without
// credentials.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const DAY = addDays(todayPkt(), -1);
const parse = (body: ReturnType<typeof recordBody>) => RecordPurchaseBodySchema().parse(body);

suite("market list and purchases are isolated per business", () => {
  let a: TestTenant;
  let b: TestTenant;
  let productA: string;
  let productB: string;
  let entryA: string;

  beforeAll(async () => {
    a = await createTenant("market-rls-a");
    b = await createTenant("market-rls-b");
    const storeA = await seedStoreWithClient(a.client, "A Store");
    const storeB = await seedStoreWithClient(b.client, "B Store");
    productA = await seedMedicineWithClient(a.client, { name: "A Panadol", unit: "strip" });
    productB = await seedMedicineWithClient(b.client, { name: "B Panadol", unit: "strip" });
    await seedConfirmedWithClient(a.client, storeA, [{ product_id: productA, quantity: 20 }], pkt(DAY, "10:00"));
    await seedConfirmedWithClient(b.client, storeB, [{ product_id: productB, quantity: 7 }], pkt(DAY, "10:00"));
    entryA = (await recordPurchase(a.client, parse(recordBody(productA, DAY, 8, { unit_cost: "90.00" })))).entry.id;
  }, 120_000);

  afterAll(async () => {
    await deleteTenant(a);
    await deleteTenant(b);
  });

  it("gives each business only its own list", async () => {
    const listA = await getMarketList(a.client, ListQuerySchema().parse({ date: DAY }));
    const listB = await getMarketList(b.client, ListQuerySchema().parse({ date: DAY }));
    expect(listA.rows.map((r) => r.name)).toEqual(["A Panadol"]);
    expect(listB.rows.map((r) => r.name)).toEqual(["B Panadol"]);
    expect(listB.rows[0]).toMatchObject({ total_requested: 7, purchased: 0 });
  });

  it("lets a user read only their own rows of the two tables directly", async () => {
    for (const table of ["purchase_entries", "purchase_voids"]) {
      const own = await a.client.from(table).select("business_id");
      expect(new Set((own.data ?? []).map((r) => r.business_id as string)), table).toEqual(table === "purchase_entries" ? new Set([a.businessId]) : new Set());
      const other = await b.client.from(table).select("*");
      expect(other.error, table).toBeNull();
      expect(other.data, table).toEqual([]);
    }
  });

  it("refuses a direct insert, update and delete of purchase rows, for the owner of the rows too", async () => {
    const insert = await a.client.from("purchase_entries").insert({ id: randomUUID(), product_id: productA, unit: "strip", purchase_date: DAY, quantity: 1 });
    expect(insert.error).not.toBeNull();
    const update = await a.client.from("purchase_entries").update({ quantity: 99 }).eq("id", entryA).select();
    expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);
    const remove = await a.client.from("purchase_entries").delete().eq("id", entryA).select();
    expect(remove.error !== null || (remove.data ?? []).length === 0).toBe(true);
    const still = await a.client.from("purchase_entries").select("quantity").eq("id", entryA).single();
    expect(still.data?.quantity).toBe(8);
  });

  it("answers a crafted medicine id and a missing one the same way, and records nothing", async () => {
    const crafted = await b.client.rpc("purchase_record", recordArgs(recordBody(productA, DAY, 5)));
    const missing = await b.client.rpc("purchase_record", recordArgs(recordBody(randomUUID(), DAY, 5)));
    expect(crafted.data).toEqual({ done: false, reason: "product_not_found" });
    expect(missing.data).toEqual(crafted.data);
    const rows = await b.client.from("purchase_entries").select("id");
    expect(rows.data).toEqual([]);
  });

  it("answers a crafted entry id in a cancel like a missing one and leaves A's entry alone", async () => {
    const crafted = await b.client.rpc("purchase_void", { p_entry: entryA, p_reason: "Not mine" });
    const missing = await b.client.rpc("purchase_void", { p_entry: randomUUID(), p_reason: "Not mine" });
    expect(crafted.data).toEqual({ done: false, reason: "not_found" });
    expect(missing.data).toEqual(crafted.data);
    const still = await a.client.from("purchase_voids").select("entry_id").eq("entry_id", entryA);
    expect(still.data).toEqual([]);
  });

  it("keeps the same entry id of two businesses apart (never a replay of the other business's entry)", async () => {
    const res = await recordPurchase(b.client, parse(recordBody(productB, DAY, 3, { id: entryA })));
    expect(res.replayed).toBe(false);
    const mine = await a.client.from("purchase_entries").select("quantity").eq("id", entryA).single();
    expect(mine.data?.quantity).toBe(8);
    await voidPurchase(b.client, entryA, VoidPurchaseBodySchema.parse({ reason: "B cancels its own" }));
    const stillOpen = await a.client.from("purchase_voids").select("entry_id").eq("entry_id", entryA);
    expect(stillOpen.data).toEqual([]);
  });

  it("gives an anonymous caller nothing", async () => {
    const anon = anonClient();
    expect((await anon.from("purchase_entries").select("*")).data ?? []).toEqual([]);
    expect((await anon.rpc("purchase_record", recordArgs(recordBody(productA, DAY, 1)))).error).not.toBeNull();
    expect((await anon.rpc("purchase_void", { p_entry: entryA, p_reason: "x" })).error).not.toBeNull();
    expect((await anon.rpc("purchase_entries_list", { p_product: productA, p_unit: "strip", p_date: DAY })).error).not.toBeNull();
  });
});
