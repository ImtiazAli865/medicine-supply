import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { applyPriceFill, listPendingPrices, previewPriceFill } from "@/lib/pending/repository";
import { PendingListQuerySchema, PriceApplyBodySchema, PriceQuerySchema } from "@/lib/validation/pending";
import { getOrderWithClient, seedMedicineWithClient, seedOrderWithClient, seedStoreWithClient } from "../helpers/pending";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// Pending Prices (the code behind /api/pending/prices) against a real Supabase test project, signed in as real
// users so Row Level Security and the database functions are in effect. Skipped without credentials.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const errorOf = async (promise: Promise<unknown>) => (await promise.then(() => null, (e) => e)) as ApiError | null;
const query = (q: string, waiting = "0") => PendingListQuerySchema.parse({ q, waiting });
const body = (price: string, lineIds: string[], fill = true, requestId = randomUUID()) => PriceApplyBodySchema.parse({ request_id: requestId, price, line_ids: lineIds, fill_lines: fill });

suite("pending prices against Supabase", () => {
  let a: TestTenant;
  let b: TestTenant;
  let storeA: string;

  beforeAll(async () => {
    a = await createTenant("prices-a");
    b = await createTenant("prices-b");
    storeA = await seedStoreWithClient(a.client);
  }, 60_000);
  afterAll(async () => {
    await deleteTenant(a);
    await deleteTenant(b);
  });

  const unique = () => `Pxq${randomUUID().slice(0, 7)}`;
  const confirmed = (productId: string, quantity = 3) => seedOrderWithClient(a.client, storeA, [{ product_id: productId, quantity, unit: "strip" }], { confirm: true });

  it("lists active unpriced medicines and priced ones with waiting lines, with the right counts", async () => {
    const u = unique();
    const unpriced = await seedMedicineWithClient(a.client, { name: `${u} Unpriced`, unit: "strip" });
    const waitingPriced = await seedMedicineWithClient(a.client, { name: `${u} Waiting`, unit: "strip" });
    const quiet = await seedMedicineWithClient(a.client, { name: `${u} Quiet`, unit: "strip", selling_price: "10.00" });
    const inactive = await seedMedicineWithClient(a.client, { name: `${u} Inactive`, unit: "strip", is_active: false });
    await seedMedicineWithClient(b.client, { name: `${u} Foreign`, unit: "strip" });
    await confirmed(unpriced, 1);
    await confirmed(unpriced, 2);
    await confirmed(waitingPriced, 4); // taken while unpriced; the medicine is priced afterwards
    await a.client.from("products").update({ selling_price: "20.00" }).eq("id", waitingPriced);

    const page = await listPendingPrices(a.client, query(u));
    const byId = Object.fromEntries(page.items.map((i) => [i.product_id, i]));
    expect(byId[unpriced]).toMatchObject({ lines_waiting: 2, orders_waiting: 2, selling_price: null });
    expect(byId[waitingPriced]).toMatchObject({ lines_waiting: 1, orders_waiting: 1 });
    expect(Number(byId[waitingPriced].selling_price)).toBe(20);
    expect(byId[quiet]).toBeUndefined(); // priced and nothing waiting
    expect(byId[inactive]).toBeUndefined();
    expect(page.items.some((i) => i.name.includes("Foreign"))).toBe(false); // another business
    expect(page.items[0].product_id).toBe(unpriced); // most waiting lines first
    expect(JSON.stringify(page)).not.toMatch(/purchase_price|"mrp"/i);

    const onlyWaiting = await listPendingPrices(a.client, query(u, "1"));
    expect(onlyWaiting.items.map((i) => i.product_id).sort()).toEqual([unpriced, waitingPriced].sort());
  });

  it("previews the exact lines with the resulting totals, total_waiting and batch_limit", async () => {
    const p = await seedMedicineWithClient(a.client, { name: unique(), unit: "strip", purchase_price: "77.77", mrp: "88.88" });
    const o1 = await confirmed(p, 3);
    const o2 = await confirmed(p, 2);
    const preview = await previewPriceFill(a.client, p, PriceQuerySchema.parse({ price: "125.5" }).price);
    expect(preview.price).toBe("125.50");
    expect(preview.lines.map((l) => l.line_id)).toEqual([o1.lineIds[0], o2.lineIds[0]]);
    expect(preview.lines[0]).toMatchObject({ quantity: 3, line_total: "376.50" });
    expect(preview).toMatchObject({ total_waiting: 2, batch_limit: 1000, untouched_priced_lines: 0 });
    expect(JSON.stringify(preview)).not.toMatch(/77\.77|88\.88|purchase_price|"mrp"/i);
  });

  it("refuses bad prices before and inside the database, and a medicine that is not yours", async () => {
    for (const bad of ["0", "12.345", "abc", "-4", ""]) {
      expect(PriceQuerySchema.safeParse({ price: bad }).success, bad).toBe(false);
      expect(PriceApplyBodySchema.safeParse({ request_id: randomUUID(), price: bad, line_ids: [], fill_lines: false }).success, bad).toBe(false);
    }
    expect(PriceApplyBodySchema.safeParse({ request_id: randomUUID(), price: "5", line_ids: [randomUUID()], fill_lines: false }).success).toBe(false);
    const p = await seedMedicineWithClient(a.client, { name: unique(), unit: "strip" });
    // the database refuses on its own even when the request skips the schema
    const raw = { request_id: randomUUID(), price: "0", line_ids: [], fill_lines: false } as never;
    expect((await errorOf(applyPriceFill(a.client, p, raw)))?.code).toBe("invalid_price");
    expect((await errorOf(previewPriceFill(b.client, p, "10.00")))?.code).toBe("not_found");
    expect((await errorOf(applyPriceFill(b.client, p, body("10", [], false))))?.code).toBe("not_found");
    expect((await errorOf(previewPriceFill(a.client, randomUUID(), "10.00")))?.code).toBe("not_found");
  });

  it("fills the reviewed lines; the order then shows the price, the line total and the price_filled event; a priced line is unchanged", async () => {
    const p = await seedMedicineWithClient(a.client, { name: unique(), unit: "strip", purchase_price: "77.77", mrp: "88.88" });
    const o1 = await confirmed(p, 3);
    await a.client.from("products").update({ selling_price: "125.50" }).eq("id", p);
    const o2 = await confirmed(p, 2); // took the price at confirm
    const o2Before = await getOrderWithClient(a.client, o2.orderId);
    const review = await previewPriceFill(a.client, p, "125.50");
    expect(review.untouched_priced_lines).toBe(1);

    const res = await applyPriceFill(a.client, p, body("125.50", review.lines.map((l) => l.line_id)));
    expect(res).toMatchObject({ replayed: false, filled_count: 1, orders_touched: 1 });
    expect(JSON.stringify(res)).not.toMatch(/77\.77|88\.88|purchase_price|"mrp"/i);

    const order = await getOrderWithClient(a.client, o1.orderId);
    expect(order.lines[0]).toMatchObject({ price_basis: "snapshot", selling_price: "125.50", line_total: "376.50" });
    expect(order.version).toBe(o1.version + 1);
    const event = order.events.find((e) => e.event_type === "price_filled") as { detail: { price_filled: Array<Record<string, unknown>> } };
    expect(event.detail.price_filled).toEqual([{ line_id: o1.lineIds[0], product_id: p, quantity: 3, previous_price: null, new_price: "125.50" }]);
    expect(JSON.stringify(order)).not.toMatch(/77\.77|88\.88|purchase_price|"mrp"/i);
    expect(await getOrderWithClient(a.client, o2.orderId)).toEqual(o2Before);
  });

  it("gives 10 simultaneous identical applies one fill and one event per order, and the same result", async () => {
    const p = await seedMedicineWithClient(a.client, { name: unique(), unit: "strip" });
    const o1 = await confirmed(p, 3);
    const o2 = await confirmed(p, 4);
    const ids = [o1.lineIds[0], o2.lineIds[0]];
    const same = body("30", ids);
    const results = await Promise.all(Array.from({ length: 10 }, () => applyPriceFill(a.client, p, same)));
    expect(results.filter((r) => r.replayed === false)).toHaveLength(1);
    expect(results.filter((r) => r.replayed === true)).toHaveLength(9);
    expect(new Set(results.map((r) => r.filled_count))).toEqual(new Set([2]));
    for (const o of [o1, o2]) {
      const order = await getOrderWithClient(a.client, o.orderId);
      expect(order.events.filter((e) => e.event_type === "price_filled")).toHaveLength(1);
      expect(order.version).toBe(o.version + 1);
      expect(order.lines[0]).toMatchObject({ selling_price: "30.00" });
    }
  }, 120_000);

  it("lets exactly one of 10 different applies for the same reviewed list win; the others are told the list changed", async () => {
    const p = await seedMedicineWithClient(a.client, { name: unique(), unit: "strip" });
    const o = await confirmed(p, 3);
    const settled = await Promise.allSettled(Array.from({ length: 10 }, () => applyPriceFill(a.client, p, body("30", o.lineIds))));
    const won = settled.filter((s) => s.status === "fulfilled");
    const lost = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
    expect(won).toHaveLength(1);
    for (const l of lost) expect((l.reason as ApiError).code).toBe("list_changed");
    const order = await getOrderWithClient(a.client, o.orderId);
    expect(order.events.filter((e) => e.event_type === "price_filled")).toHaveLength(1);
    expect(order.version).toBe(o.version + 1);
  }, 120_000);

  it("returns list_changed with the current lines when the list changed after the review, and fills nothing", async () => {
    const p = await seedMedicineWithClient(a.client, { name: unique(), unit: "strip" });
    const o1 = await confirmed(p, 1);
    const o2 = await confirmed(p, 2);
    const review = await previewPriceFill(a.client, p, "20.00");
    const cancel = await a.client.rpc("order_cancel", { p_id: o2.orderId, p_request_id: randomUUID(), p_expected_version: o2.version, p_reason: "test" });
    expect(cancel.error).toBeNull();
    const error = await errorOf(applyPriceFill(a.client, p, body("20", review.lines.map((l) => l.line_id))));
    expect(error?.code).toBe("list_changed");
    expect((error?.current_lines as Array<{ line_id: string }>).map((l) => l.line_id)).toEqual([o1.lineIds[0]]);
    expect((await getOrderWithClient(a.client, o1.orderId)).lines[0]).toMatchObject({ price_basis: "none", selling_price: null });
    expect((await a.client.from("products").select("selling_price").eq("id", p).single()).data?.selling_price).toBeNull();
  });

  it("refuses a different price for a medicine that already has one, with that price", async () => {
    const p = await seedMedicineWithClient(a.client, { name: unique(), unit: "strip", selling_price: "10.00" });
    const error = await errorOf(applyPriceFill(a.client, p, body("12", [], false)));
    expect(error?.code).toBe("price_differs");
    expect(Number(error?.current_price)).toBe(10);
    expect((await errorOf(previewPriceFill(a.client, p, "12.00")))?.code).toBe("price_differs");
  });

  it("saves only the price with fill_lines = false and leaves the lines waiting", async () => {
    const p = await seedMedicineWithClient(a.client, { name: unique(), unit: "strip" });
    const o = await confirmed(p, 3);
    const res = await applyPriceFill(a.client, p, body("40", [], false));
    expect(res).toMatchObject({ filled_count: 0, orders_touched: 0 });
    expect(Number((await a.client.from("products").select("selling_price").eq("id", p).single()).data?.selling_price)).toBe(40);
    const order = await getOrderWithClient(a.client, o.orderId);
    expect(order.lines[0]).toMatchObject({ price_basis: "none", selling_price: null });
    expect(order.version).toBe(o.version);
  });
});
