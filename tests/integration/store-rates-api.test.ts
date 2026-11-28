import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { confirmOrder, getOrder, saveOrder } from "@/lib/orders/repository";
import { listAllRates, listStoreRates, removeStoreRate, setStoreRate } from "@/lib/rates/repository";
import { OrderSaveSchema } from "@/lib/validation/order";
import { bothTenants, insertMedicines, priceLeaks, seedStoreWithClient } from "../helpers/fast";
import { deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// Module 012 against the real Supabase test project (migration 0012 applied there): the rate functions and the order
// fields as two real businesses see them.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

suite("store rates (real Supabase test project)", () => {
  let a: TestTenant;
  let b: TestTenant;
  let store: string;
  let medicine: string;

  beforeAll(async () => {
    ({ a, b } = await bothTenants());
    store = await seedStoreWithClient(a.client, "Rate Store");
    medicine = (await insertMedicines(a.client, [{ name: "Rate Med", selling_price: "210.00" }]))[0]!;
  }, 60_000);

  afterAll(async () => {
    await Promise.all([a && deleteTenant(a), b && deleteTenant(b)]);
  }, 60_000);

  it("sets, lists and pages the rates of one business only", async () => {
    const set = await setStoreRate(a.client, store, medicine, "220", null);
    expect(set).toMatchObject({ rate: "220.00", version: 1, catalog_price: "210.00" });
    const list = await listStoreRates(a.client, store);
    expect(list.items).toHaveLength(1);
    expect(priceLeaks(list)).toEqual([]);
    expect((await listAllRates(a.client, 900, undefined)).items).toEqual([
      { store_id: store, product_id: medicine, rate: "220.00", version: 1, catalog_price_at_set: "210.00" },
    ]);
    await expect(listStoreRates(b.client, store)).rejects.toMatchObject({ code: "not_found" });
    await expect(setStoreRate(b.client, store, medicine, "1", null)).rejects.toMatchObject({ code: "not_found" });
    expect((await listAllRates(b.client, 900, undefined)).items).toEqual([]);
    expect((await b.client.from("store_rates").select("*")).data).toEqual([]);
    expect((await a.client.from("store_rates").update({ rate: 1 }).eq("store_id", store)).error).not.toBeNull();
  });

  it("prices an order from the store's rate, checks the shown price at confirm, and answers version conflicts", async () => {
    const id = randomUUID();
    const lineId = randomUUID();
    const input = OrderSaveSchema.parse({
      request_id: randomUUID(),
      expected_version: null,
      store_id: store,
      notes: null,
      lines: [{ id: lineId, product_id: medicine, name: null, quantity: 2, unit: "strip" }],
    });
    const { result } = await saveOrder(a.client, id, input);
    expect(result.order.lines[0]).toMatchObject({ selling_price: "220.00", price_source: "store_rate", rate: { rate: "220.00", version: 1 } });

    await expect(
      confirmOrder(a.client, id, { request_id: randomUUID(), expected_version: result.order.version, expected_prices: [{ line_id: lineId, selling_price: "210.00" }] }),
    ).rejects.toMatchObject({ code: "price_changed" });
    const done = await confirmOrder(a.client, id, {
      request_id: randomUUID(),
      expected_version: result.order.version,
      expected_prices: [{ line_id: lineId, selling_price: "220.00" }],
    });
    expect(done.order.lines[0]).toMatchObject({ selling_price: "220.00", price_basis: "snapshot" });
    expect((await getOrder(a.client, id))!.totals.priced_total).toBe("440.00");

    await expect(setStoreRate(a.client, store, medicine, "230", null)).rejects.toMatchObject({ code: "version_conflict" });
    await setStoreRate(a.client, store, medicine, "230", 1);
    await removeStoreRate(a.client, store, medicine, 2);
    expect((await listStoreRates(a.client, store)).items).toEqual([]);
  });

  it("keeps a typed price and remembers it through the order save", async () => {
    const other = await seedStoreWithClient(a.client, "Typed Rate Store");
    const input = OrderSaveSchema.parse({
      request_id: randomUUID(),
      expected_version: null,
      store_id: other,
      notes: null,
      lines: [{ id: randomUUID(), product_id: medicine, name: null, quantity: 1, unit: "strip", price: "199.50", remember: true, rate_version: null }],
    });
    const { result } = await saveOrder(a.client, randomUUID(), input);
    expect(result.order.lines[0]).toMatchObject({ selling_price: "199.50", chosen_price: "199.50", price_source: "typed" });
    expect(result.rate_conflicts).toEqual([]);
    expect((await listStoreRates(a.client, other)).items.map((r) => r.rate)).toEqual(["199.50"]);
  });
});
