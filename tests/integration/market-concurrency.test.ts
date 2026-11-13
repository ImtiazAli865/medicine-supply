import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMarketList, listPurchases, recordPurchase, voidPurchase } from "@/lib/market/repository";
import { ListQuerySchema, RecordPurchaseBodySchema, VoidPurchaseBodySchema } from "@/lib/validation/market";
import { addDays, pkt, recordBody, seedConfirmedWithClient, todayPkt } from "../helpers/market";
import { seedMedicineWithClient, seedStoreWithClient } from "../helpers/pending";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// Simultaneous requests through separate connections to the real Supabase test project: this is where the
// advisory lock on the entry id and the unique cancellation are proven, not only on one in-memory connection.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const DAY = addDays(todayPkt(), -1);
const parse = (body: ReturnType<typeof recordBody>) => RecordPurchaseBodySchema().parse(body);

suite("purchases under simultaneous requests", () => {
  let a: TestTenant;
  let panadol: string;
  const entriesOf = async (id: string) => (await a.client.from("purchase_entries").select("id").eq("id", id)).data ?? [];
  const purchased = async () => (await getMarketList(a.client, ListQuerySchema().parse({ date: DAY }))).rows.find((r) => r.product_id === panadol)!.purchased;

  beforeAll(async () => {
    a = await createTenant("purchase-conc");
    const store = await seedStoreWithClient(a.client);
    panadol = await seedMedicineWithClient(a.client, { name: "Panadol", unit: "strip" });
    await seedConfirmedWithClient(a.client, store, [{ product_id: panadol, quantity: 100 }], pkt(DAY, "10:00"));
  }, 120_000);

  afterAll(async () => {
    await deleteTenant(a);
  });

  it("gives 10 simultaneous identical record requests exactly one entry", async () => {
    const body = parse(recordBody(panadol, DAY, 6));
    const results = await Promise.all(Array.from({ length: 10 }, () => recordPurchase(a.client, body)));
    expect(results.filter((r) => r.replayed === false)).toHaveLength(1);
    expect(results.filter((r) => r.replayed === true)).toHaveLength(9);
    expect(new Set(results.map((r) => r.entry.id)).size).toBe(1);
    expect(await entriesOf(body.id)).toHaveLength(1);
    expect(await purchased()).toBe(6);
  }, 120_000);

  it("gives 10 simultaneous cancels of one entry exactly one cancellation", async () => {
    const entry = await recordPurchase(a.client, parse(recordBody(panadol, DAY, 4)));
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => voidPurchase(a.client, entry.entry.id, VoidPurchaseBodySchema.parse({ reason: `Reason ${i}` }))));
    expect(results.filter((r) => r.replayed === false)).toHaveLength(1);
    expect(new Set(results.map((r) => r.entry.void?.reason)).size).toBe(1); // everyone sees the one stored reason
    const voids = await a.client.from("purchase_voids").select("entry_id").eq("entry_id", entry.entry.id);
    expect(voids.data).toHaveLength(1);
    expect(await purchased()).toBe(6);
  }, 120_000);

  it("keeps 10 simultaneous different purchases (different ids) and adds them up", async () => {
    const before = await purchased();
    const bodies = Array.from({ length: 10 }, (_, i) => parse(recordBody(panadol, DAY, i + 1)));
    await Promise.all(bodies.map((b) => recordPurchase(a.client, b)));
    expect(await purchased()).toBe(before + 55);
    const list = await listPurchases(a.client, { product: panadol, unit: "strip", date: DAY });
    expect(list.entries.filter((e) => bodies.some((b) => b.id === e.id))).toHaveLength(10);
  }, 120_000);

  it("lets exactly one of two simultaneous different-content requests with the same id win", async () => {
    const id = randomUUID();
    const settled = await Promise.allSettled([
      recordPurchase(a.client, parse(recordBody(panadol, DAY, 5, { id }))),
      recordPurchase(a.client, parse(recordBody(panadol, DAY, 9, { id }))),
    ]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((s) => s.status === "rejected")).toHaveLength(1);
    expect(await entriesOf(id)).toHaveLength(1);
  }, 120_000);
});
