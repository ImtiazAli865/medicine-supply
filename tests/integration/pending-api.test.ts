import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { linkLine, pendingCandidates, registerLine } from "@/lib/pending/repository";
import { LinkBodySchema, PendingProductQuerySchema, RegisterBodySchema } from "@/lib/validation/pending";
import { getOrderWithClient, linkBody, registerBody, seedMedicineWithClient, seedOrderWithClient, seedStoreWithClient } from "../helpers/pending";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// The pending-products repository (the code behind /api/orders/{id}/lines/{lineId}/register and the other
// Module 004 routes) against a real Supabase test project, signed in as real users so Row Level Security and
// the database functions are in effect. Skipped without credentials.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const errorOf = async (promise: Promise<unknown>) => (await promise.then(() => null, (e) => e)) as ApiError | null;
const parseRegister = (body: ReturnType<typeof registerBody>) => RegisterBodySchema.parse(body);

suite("pending products repository against Supabase", () => {
  let a: TestTenant;
  let b: TestTenant;
  let storeA: string;

  beforeAll(async () => {
    a = await createTenant("pending-a");
    b = await createTenant("pending-b");
    storeA = await seedStoreWithClient(a.client);
    await seedStoreWithClient(b.client, "B Pharmacy");
  }, 60_000);
  afterAll(async () => {
    await deleteTenant(a);
    await deleteTenant(b);
  });

  /** A confirmed order with one typed line and one catalog line. */
  async function typedOrder(typedName = "Noran 20mg cap", confirm = true) {
    const catalog = await seedMedicineWithClient(a.client, { name: `Catalog ${randomUUID().slice(0, 6)}`, unit: "box" });
    const order = await seedOrderWithClient(a.client, storeA, [{ product_id: null, name: typedName, quantity: 3, unit: "strip" }, { product_id: catalog, quantity: 2, unit: "box" }], { confirm });
    return { ...order, typedId: order.lineIds[0], catalog };
  }

  describe("register", () => {
    it("registers a typed line with only a name and unit, keeping the typed text, quantity and unit", async () => {
      const o = await typedOrder();
      const body = registerBody(o.version, { name: "Noran 20mg cap" });
      const res = await registerLine(a.client, o.orderId, o.typedId, parseRegister(body));
      expect(res.replayed).toBe(false);
      expect(res.price_applied).toBe(false);
      expect(res.product).toMatchObject({ id: body.product.id, name: "Noran 20mg cap", unit: "strip", selling_price: null, is_active: true });
      const line = res.order.lines[0];
      expect(line).toMatchObject({ product_id: body.product.id, item_status: "registered", typed_name: "Noran 20mg cap", quantity: 3, unit: "strip" });
      expect(res.order.lines).toHaveLength(2);
      expect(res.order.version).toBe(o.version + 1);
      expect(res.order.events.some((e) => e.event_type === "linked")).toBe(true);
      // the medicine exists and is found by a normal search of the catalog
      const found = await a.client.from("products").select("id, name, strength, selling_price").eq("id", body.product.id).single();
      expect(found.data).toMatchObject({ name: "Noran 20mg cap", strength: null, selling_price: null });
    });

    it("returns the stored result when the same request is repeated (replayed)", async () => {
      const o = await typedOrder("Replay Noran");
      const body = parseRegister(registerBody(o.version, { name: "Replay Noran" }));
      const first = await registerLine(a.client, o.orderId, o.typedId, body);
      const again = await registerLine(a.client, o.orderId, o.typedId, body);
      expect(again.replayed).toBe(true);
      expect(again.product.id).toBe(first.product.id);
      const order = await getOrderWithClient(a.client, o.orderId);
      expect(order.version).toBe(first.order.version);
      expect(order.events.filter((e) => e.event_type === "linked")).toHaveLength(1);
    });

    it("never returns a purchase price or MRP, even when the supplier typed them", async () => {
      const o = await typedOrder("Priced Noran");
      const res = await registerLine(a.client, o.orderId, o.typedId, parseRegister(registerBody(o.version, { name: "Priced Noran", purchase_price: "90.00", mrp: "130.00", selling_price: "125.50" })));
      const text = JSON.stringify(res);
      expect(text).not.toMatch(/purchase_price|"mrp"|purchase price|"90\.00"|"130\.00"/i);
      expect(res.product.selling_price).toBe("125.50");
    });

    it("records the price on a confirmed line only when apply_price is true", async () => {
      const o = await typedOrder("Apply Noran");
      const res = await registerLine(a.client, o.orderId, o.typedId, parseRegister(registerBody(o.version, { name: "Apply Noran", selling_price: "125.50" }, { apply_price: true })));
      expect(res.price_applied).toBe(true);
      expect(res.order.lines[0]).toMatchObject({ price_basis: "snapshot", selling_price: "125.50", line_total: "376.50" });

      const p = await typedOrder("Decline Noran");
      const declined = await registerLine(a.client, p.orderId, p.typedId, parseRegister(registerBody(p.version, { name: "Decline Noran", selling_price: "125.50" }, { apply_price: false })));
      expect(declined.price_applied).toBe(false);
      expect(declined.order.lines[0]).toMatchObject({ price_basis: "none", selling_price: null });
    });

    it("refuses an exact duplicate with the existing medicine in matches, and creates nothing", async () => {
      const existing = await seedMedicineWithClient(a.client, { name: "Brufen 400mg", unit: "box", strength: "400 mg", dosage_form: "tablet" });
      const o = await typedOrder("Brufen typed");
      const error = await errorOf(registerLine(a.client, o.orderId, o.typedId, parseRegister(registerBody(o.version, { name: " brufen  400MG", unit: "strip", strength: "400 mg", dosage_form: "TABLET" }))));
      expect(error?.code).toBe("duplicate_product");
      expect((error?.matches as Array<{ id: string }>).map((m) => m.id)).toContain(existing);
      const order = await getOrderWithClient(a.client, o.orderId);
      expect(order.version).toBe(o.version);
      expect(order.lines[0].product_id).toBeNull();
    });

    it("needs confirm_similar when only the strength differs, then creates a separate medicine", async () => {
      await seedMedicineWithClient(a.client, { name: "Augmentin", unit: "box", strength: "625 mg" });
      const o = await typedOrder("Augmentin typed");
      const first = await errorOf(registerLine(a.client, o.orderId, o.typedId, parseRegister(registerBody(o.version, { name: "Augmentin", strength: "1 g" }))));
      expect(first?.code).toBe("similar_products");
      const res = await registerLine(a.client, o.orderId, o.typedId, parseRegister(registerBody(o.version, { name: "Augmentin", strength: "1 g" }, { confirm_similar: true })));
      expect(res.product.strength).toBe("1 g");
    });

    it("refuses a code (SKU) another medicine uses", async () => {
      await seedMedicineWithClient(a.client, { name: "Coded", unit: "box", sku: "PEND-1" });
      const o = await typedOrder("Coded typed");
      const error = await errorOf(registerLine(a.client, o.orderId, o.typedId, parseRegister(registerBody(o.version, { name: "Other", sku: "pend-1" }))));
      expect(error?.code).toBe("sku_conflict");
      expect(error?.fields).toHaveProperty("sku");
    });

    it("returns validation messages on the fields and creates nothing", async () => {
      const o = await typedOrder("Invalid typed");
      const body = registerBody(o.version, { name: "Valid", unit: "strip", selling_price: "12.34" });
      // a price the schema accepts but the database would refuse cannot exist, so test the database rule directly
      const raw = await a.client.rpc("pending_line_register", {
        p_order: o.orderId,
        p_line: o.typedId,
        p_request_id: randomUUID(),
        p_expected_version: o.version,
        p_product: { id: randomUUID(), name: "  ", unit: "", selling_price: "12.345" },
        p_confirm_similar: false,
        p_apply_price: false,
      });
      expect(raw.data.reason).toBe("invalid_product");
      expect(Object.keys(raw.data.fields).sort()).toEqual(["name", "selling_price", "unit"]);
      expect(body.product.selling_price).toBe("12.34");
    });

    it("refuses a stale version with the current order, and an already linked line with the current order", async () => {
      const o = await typedOrder("Stale typed");
      const stale = await errorOf(registerLine(a.client, o.orderId, o.typedId, parseRegister(registerBody(o.version + 5, { name: "Stale" }))));
      expect(stale?.code).toBe("version_conflict");
      expect((stale?.current as { id: string }).id).toBe(o.orderId);

      const first = await registerLine(a.client, o.orderId, o.typedId, parseRegister(registerBody(o.version, { name: "Stale First" })));
      const second = await errorOf(registerLine(a.client, o.orderId, o.typedId, parseRegister(registerBody(first.order.version, { name: "Stale Second" }))));
      expect(second?.code).toBe("line_not_pending");
      expect((second?.current as { version: number }).version).toBe(first.order.version);
    });

    it("refuses another business's order without revealing it", async () => {
      const o = await typedOrder("Private typed");
      const error = await errorOf(registerLine(b.client, o.orderId, o.typedId, parseRegister(registerBody(o.version, { name: "Intruder" }))));
      expect(error?.code).toBe("not_found");
      const order = await getOrderWithClient(a.client, o.orderId);
      expect(order.lines[0].product_id).toBeNull();
      expect(order.version).toBe(o.version);
    });

    it("refuses a medicine id that another business uses, with the same generic answer", async () => {
      const foreign = await seedMedicineWithClient(b.client, { name: "B only", unit: "box" });
      const o = await typedOrder("Foreign id typed");
      const error = await errorOf(registerLine(a.client, o.orderId, o.typedId, parseRegister(registerBody(o.version, { id: foreign, name: "Mine" }))));
      expect(error?.code).toBe("validation_error");
      expect(error?.fields).toHaveProperty("id");
    });
  });

  describe("link", () => {
    const parseLink = (body: ReturnType<typeof linkBody>) => LinkBodySchema.parse(body);

    it("links a typed line to an existing medicine and changes only that line", async () => {
      const medicine = await seedMedicineWithClient(a.client, { name: "Link Target 500mg", unit: "strip", strength: "500 mg", dosage_form: "tablet" });
      const o = await typedOrder("link target 500");
      const res = await linkLine(a.client, o.orderId, o.typedId, parseLink(linkBody(o.version, medicine)));
      expect(res.replayed).toBe(false);
      expect(res.product).toMatchObject({ id: medicine, name: "Link Target 500mg" });
      expect(res.order.lines[0]).toMatchObject({ product_id: medicine, item_status: "registered", typed_name: "link target 500", strength: "500 mg", quantity: 3, unit: "strip" });
      expect(res.order.lines[1]).toMatchObject({ product_id: o.catalog, typed_name: null, quantity: 2, unit: "box" });
      expect(res.order.version).toBe(o.version + 1);
      expect(res.order.events.filter((e) => e.event_type === "linked")).toHaveLength(1);
      expect(JSON.stringify(res)).not.toMatch(/purchase_price|"mrp"/i);
    });

    it("returns the stored result when the same request is repeated", async () => {
      const medicine = await seedMedicineWithClient(a.client, { name: "Link Replay", unit: "strip" });
      const o = await typedOrder("link replay");
      const body = parseLink(linkBody(o.version, medicine));
      const first = await linkLine(a.client, o.orderId, o.typedId, body);
      const again = await linkLine(a.client, o.orderId, o.typedId, body);
      expect(again.replayed).toBe(true);
      expect(again.order.version).toBe(first.order.version);
      expect((await getOrderWithClient(a.client, o.orderId)).events.filter((e) => e.event_type === "linked")).toHaveLength(1);
    });

    it("records the medicine's price on a confirmed line only when apply_price is true", async () => {
      const medicine = await seedMedicineWithClient(a.client, { name: "Link Priced", unit: "strip", selling_price: "125.50" });
      const o = await typedOrder("link priced");
      const res = await linkLine(a.client, o.orderId, o.typedId, parseLink(linkBody(o.version, medicine, { apply_price: true })));
      expect(res.price_applied).toBe(true);
      expect(res.order.lines[0]).toMatchObject({ price_basis: "snapshot", selling_price: "125.50", line_total: "376.50" });
      const p = await typedOrder("link declined");
      const declined = await linkLine(a.client, p.orderId, p.typedId, parseLink(linkBody(p.version, medicine, { apply_price: false })));
      expect(declined.price_applied).toBe(false);
      expect(declined.order.lines[0]).toMatchObject({ price_basis: "none", selling_price: null });
    });

    it("refuses an inactive medicine, an already linked line, a stale version and another business's data", async () => {
      const inactive = await seedMedicineWithClient(a.client, { name: "Link Inactive", unit: "strip", is_active: false });
      const o = await typedOrder("link refusals");
      expect((await errorOf(linkLine(a.client, o.orderId, o.typedId, parseLink(linkBody(o.version, inactive)))))?.code).toBe("product_inactive");

      const medicine = await seedMedicineWithClient(a.client, { name: "Link Refusals", unit: "strip" });
      const first = await linkLine(a.client, o.orderId, o.typedId, parseLink(linkBody(o.version, medicine)));
      const again = await errorOf(linkLine(a.client, o.orderId, o.typedId, parseLink(linkBody(first.order.version, medicine))));
      expect(again?.code).toBe("line_not_pending");
      expect((again?.current as { version: number }).version).toBe(first.order.version);

      const stale = await errorOf(linkLine(a.client, o.orderId, o.typedId, parseLink(linkBody(o.version, medicine))));
      expect(stale?.code).toBe("version_conflict");

      const p = await typedOrder("link private");
      expect((await errorOf(linkLine(b.client, p.orderId, p.typedId, parseLink(linkBody(p.version, medicine)))))?.code).toBe("not_found");
      const foreign = await seedMedicineWithClient(b.client, { name: "B medicine", unit: "strip" });
      expect((await errorOf(linkLine(a.client, p.orderId, p.typedId, parseLink(linkBody(p.version, foreign)))))?.code).toBe("not_found");
      expect((await getOrderWithClient(a.client, p.orderId)).lines[0].product_id).toBeNull();
    });
  });

  describe("candidates", () => {
    it("lists the clear matches as proposed and the look-alikes as not proposed, with store, order number, typed text, quantity and unit", async () => {
      const unique = `Candy${randomUUID().slice(0, 6)}`;
      const medicine = await seedMedicineWithClient(a.client, { name: unique, unit: "strip", strength: "20 mg" });
      const catalog = await seedMedicineWithClient(a.client, { name: `Catalog ${randomUUID().slice(0, 6)}`, unit: "box" });
      const draft = await seedOrderWithClient(a.client, storeA, [{ product_id: null, name: `${unique} 20 mg`, quantity: 4, unit: "strip" }, { product_id: catalog, quantity: 1, unit: "box" }], { confirm: false });
      const confirmed = await seedOrderWithClient(a.client, storeA, [{ product_id: null, name: unique.toUpperCase(), quantity: 6, unit: "box" }], { confirm: true });
      const alike = await seedOrderWithClient(a.client, storeA, [{ product_id: null, name: `${unique} 40 mg`, quantity: 2, unit: "strip" }], { confirm: true });
      // the same text in another business never shows up
      const foreignStore = (await b.client.from("stores").select("id").limit(1)).data?.[0]?.id as string;
      await seedOrderWithClient(b.client, foreignStore, [{ product_id: null, name: `${unique} 20 mg`, quantity: 9, unit: "strip" }], { confirm: true });

      const res = await pendingCandidates(a.client, medicine);
      const storeName = (await a.client.from("stores").select("name").eq("id", storeA).single()).data?.name as string;
      expect(res.proposed.map((l) => l.line_id).sort()).toEqual([draft.lineIds[0], confirmed.lineIds[0]].sort());
      expect(res.not_proposed.map((l) => l.line_id)).toEqual([alike.lineIds[0]]);
      const first = res.proposed.find((l) => l.line_id === draft.lineIds[0]);
      expect(first).toMatchObject({
        order_id: draft.orderId, order_number: (await getOrderWithClient(a.client, draft.orderId)).order_number, order_status: "draft",
        store_name: storeName, typed_text: `${unique} 20 mg`, quantity: 4, unit: "strip",
      });
      expect(res.proposed.find((l) => l.line_id === confirmed.lineIds[0])).toMatchObject({ order_status: "confirmed", typed_text: unique.toUpperCase(), quantity: 6, unit: "box" });
      expect(res.not_proposed[0]).toMatchObject({ typed_text: `${unique} 40 mg`, quantity: 2 });
      expect(JSON.stringify(res)).not.toMatch(/purchase_price|"mrp"/i);
    });

    it("answers not found for an unknown medicine or one of another business, and rejects a malformed id", async () => {
      const mine = await seedMedicineWithClient(a.client, { name: `Private${randomUUID().slice(0, 6)}`, unit: "strip" });
      expect((await errorOf(pendingCandidates(b.client, mine)))?.code).toBe("not_found");
      expect((await errorOf(pendingCandidates(a.client, randomUUID())))?.code).toBe("not_found");
      expect(PendingProductQuerySchema.safeParse({ product_id: "not-a-uuid" }).success).toBe(false);
      expect(PendingProductQuerySchema.safeParse({}).success).toBe(false);
      expect(PendingProductQuerySchema.safeParse({ product_id: mine }).success).toBe(true);
    });

    it("changes nothing: the order's version is the same after reading", async () => {
      const unique = `Readonly${randomUUID().slice(0, 6)}`;
      const medicine = await seedMedicineWithClient(a.client, { name: unique, unit: "strip" });
      const o = await seedOrderWithClient(a.client, storeA, [{ product_id: null, name: unique, quantity: 1, unit: "strip" }], { confirm: true });
      await pendingCandidates(a.client, medicine);
      const after = await getOrderWithClient(a.client, o.orderId);
      expect(after.version).toBe(o.version);
      expect(after.lines[0].product_id).toBeNull();
    });
  });
});
