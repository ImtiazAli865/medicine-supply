import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { applyPriceFill, linkLine, listPendingPrices, listTypedGroups, pendingCandidates, pendingSummary, previewPriceFill, registerLine } from "@/lib/pending/repository";
import { LinkBodySchema, PendingListQuerySchema, PriceApplyBodySchema, RegisterBodySchema } from "@/lib/validation/pending";
import { getOrderWithClient, linkBody, registerBody, seedMedicineWithClient, seedOrderWithClient, seedStoreWithClient } from "../helpers/pending";
import { anonClient, createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// Isolation of Module 004 between two real businesses (SC-008), on the Supabase test project. Every request is
// made as a real signed-in user (or a visitor), so Row Level Security and the function grants are in effect.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const errorOf = async (promise: Promise<unknown>) => (await promise.then(() => null, (e) => e)) as ApiError | null;

suite("Module 004 isolation against Supabase", () => {
  let a: TestTenant;
  let b: TestTenant;
  let productA: string;
  let orderA: Awaited<ReturnType<typeof seedOrderWithClient>>;
  let confirmedA: Awaited<ReturnType<typeof seedOrderWithClient>>;
  let storeB: string;
  const secret = `Secret${randomUUID().slice(0, 6)}`;

  beforeAll(async () => {
    a = await createTenant("rls4-a");
    b = await createTenant("rls4-b");
    const storeA = await seedStoreWithClient(a.client, "A Private Store");
    storeB = await seedStoreWithClient(b.client, "B Store");
    productA = await seedMedicineWithClient(a.client, { name: `${secret} Medicine`, unit: "strip", purchase_price: "11.11" });
    orderA = await seedOrderWithClient(a.client, storeA, [{ product_id: null, name: `${secret} Medicine`, quantity: 3, unit: "strip" }, { product_id: productA, quantity: 2, unit: "strip" }], { confirm: true });
    confirmedA = await seedOrderWithClient(a.client, storeA, [{ product_id: productA, quantity: 5, unit: "strip" }], { confirm: true });
  }, 90_000);
  afterAll(async () => {
    await deleteTenant(a);
    await deleteTenant(b);
  });

  const linesOfA = async () => JSON.stringify([await getOrderWithClient(a.client, orderA.orderId), await getOrderWithClient(a.client, confirmedA.orderId)]);

  it("B gets 'not found' for A's order, line and medicine in every write, and A's rows do not change", async () => {
    const before = await linesOfA();
    const reg = await errorOf(registerLine(b.client, orderA.orderId, orderA.lineIds[0], RegisterBodySchema.parse(registerBody(orderA.version, { name: "Intruder" }))));
    const own = await seedMedicineWithClient(b.client, { name: `B ${secret}`, unit: "strip" });
    const link = await errorOf(linkLine(b.client, orderA.orderId, orderA.lineIds[0], LinkBodySchema.parse(linkBody(orderA.version, own))));
    const linkForeign = await errorOf(
      (async () => {
        const o = await seedOrderWithClient(b.client, storeB, [{ product_id: null, name: "B typed", quantity: 1, unit: "strip" }]);
        return linkLine(b.client, o.orderId, o.lineIds[0], LinkBodySchema.parse(linkBody(o.version, productA)));
      })(),
    );
    const preview = await errorOf(previewPriceFill(b.client, productA, "10.00"));
    const apply = await errorOf(applyPriceFill(b.client, productA, PriceApplyBodySchema.parse({ request_id: randomUUID(), price: "10", line_ids: [confirmedA.lineIds[0]], fill_lines: true })));
    const candidates = await errorOf(pendingCandidates(b.client, productA));
    for (const e of [reg, link, linkForeign, preview, apply, candidates]) {
      expect(e).toBeInstanceOf(ApiError);
      expect(e!.code).toBe("not_found");
      expect(JSON.stringify({ m: e!.message, c: e!.current, l: e!.current_lines })).not.toMatch(new RegExp(`${secret}|A Private Store`));
    }
    expect(await linesOfA()).toBe(before);
    expect((await a.client.from("products").select("selling_price").eq("id", productA).single()).data?.selling_price).toBeNull();
  });

  it("A's line ids sent for B's own medicine fill nothing of A and describe none of A's lines", async () => {
    const before = await linesOfA();
    const ownProduct = await seedMedicineWithClient(b.client, { name: `B own ${secret}`, unit: "strip" });
    const ownOrder = await seedOrderWithClient(b.client, storeB, [{ product_id: ownProduct, quantity: 1, unit: "strip" }], { confirm: true });
    const error = await errorOf(applyPriceFill(b.client, ownProduct, PriceApplyBodySchema.parse({ request_id: randomUUID(), price: "10", line_ids: [confirmedA.lineIds[0], ...ownOrder.lineIds], fill_lines: true })));
    expect(error?.code).toBe("list_changed");
    expect((error?.current_lines as Array<{ line_id: string }>).map((l) => l.line_id)).toEqual(ownOrder.lineIds);
    expect(JSON.stringify(error?.current_lines)).not.toMatch(/A Private Store/);
    expect(await linesOfA()).toBe(before);
  });

  it("the summary and both lists of B hold nothing of A, and A's counts are A's own", async () => {
    const listsB = JSON.stringify([
      await pendingSummary(b.client),
      await listTypedGroups(b.client, PendingListQuerySchema.parse({ q: secret })),
      await listPendingPrices(b.client, PendingListQuerySchema.parse({ q: secret })),
    ]);
    expect(listsB).not.toMatch(new RegExp(`${secret} Medicine|A Private Store`));
    expect((await listTypedGroups(b.client, PendingListQuerySchema.parse({ q: secret }))).items).toEqual([]);
    expect((await listTypedGroups(a.client, PendingListQuerySchema.parse({ q: secret }))).items).toHaveLength(1);
    expect((await listPendingPrices(a.client, PendingListQuerySchema.parse({ q: secret }))).items.map((i) => i.product_id)).toEqual([productA]);
  });

  it("a request id used by A is not replayed for B", async () => {
    const shared = randomUUID();
    const typedA = await seedOrderWithClient(a.client, await seedStoreWithClient(a.client, "A Second Store"), [{ product_id: null, name: "Replay Shared", quantity: 1, unit: "strip" }], { confirm: true });
    const typedB = await seedOrderWithClient(b.client, storeB, [{ product_id: null, name: "Replay Shared", quantity: 1, unit: "strip" }], { confirm: true });
    const forA = await registerLine(a.client, typedA.orderId, typedA.lineIds[0], RegisterBodySchema.parse({ ...registerBody(typedA.version, { name: "Replay Shared" }), request_id: shared }));
    const forB = await registerLine(b.client, typedB.orderId, typedB.lineIds[0], RegisterBodySchema.parse({ ...registerBody(typedB.version, { name: "Replay Shared" }), request_id: shared }));
    expect(forA.replayed).toBe(false);
    expect(forB.replayed).toBe(false);
    expect(forB.product.id).not.toBe(forA.product.id);
    expect((await getOrderWithClient(b.client, typedB.orderId)).lines[0].product_id).toBe(forB.product.id);
  });

  it("the idempotency table is closed to both users and to visitors, and a visitor can call no function", async () => {
    for (const client of [a.client, b.client, anonClient()]) {
      const read = await client.from("pending_requests").select("*");
      expect(read.error?.code === "42501" || (read.data ?? []).length === 0, "no rows and no permission").toBe(true);
      expect((read.data ?? []).length).toBe(0);
      const write = await client.from("pending_requests").insert({ business_id: a.businessId, request_id: randomUUID(), kind: "link", result: {} });
      expect(write.error).not.toBeNull();
    }
    const visitor = anonClient();
    const calls = await Promise.all([
      visitor.rpc("pending_summary"),
      visitor.rpc("pending_typed_groups", { p_q: null, p_limit: 10, p_offset: 0 }),
      visitor.rpc("pending_prices_list", { p_q: null, p_only_waiting: false, p_limit: 10, p_offset: 0 }),
      visitor.rpc("pending_candidates", { p_product: productA }),
      visitor.rpc("pending_price_preview", { p_product: productA, p_price: "10" }),
      visitor.rpc("pending_price_apply", { p_product: productA, p_price: "10", p_request_id: randomUUID(), p_line_ids: [], p_fill_lines: false }),
      visitor.rpc("pending_line_link", { p_order: orderA.orderId, p_line: orderA.lineIds[0], p_request_id: randomUUID(), p_expected_version: 1, p_product_id: productA, p_apply_price: false, p_how: "existing" }),
    ]);
    for (const call of calls) {
      expect(call.error, "a visitor gets an error").not.toBeNull();
      expect(call.data).toBeNull();
    }
  });
});
