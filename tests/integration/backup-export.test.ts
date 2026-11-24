import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportPage } from "@/lib/backup/export-repository";
import { bothTenants, insertMedicines, priceLeaks, seedConfirmedOrder, seedOrderWithClient, seedStoreWithClient } from "../helpers/fast";
import { deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// The backup export reads (Module 009) against the real Supabase test project with two real businesses. They run as the
// signed-in user, so Row Level Security is what keeps the other business out.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

suite("backup export (real Supabase test project)", () => {
  let a: TestTenant;
  let b: TestTenant;
  let aStore: string;
  let aOrders: string[] = [];

  beforeAll(async () => {
    ({ a, b } = await bothTenants());
    aStore = await seedStoreWithClient(a.client, "Alpha Export Store");
    const [m1] = await insertMedicines(a.client, [{ name: "Export Med", strength: "500 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "Acme", selling_price: "12.00", purchase_price: "5.00" }]);
    // a draft with a catalog line and a typed line, and a confirmed order (which carries a price snapshot in the database)
    const draft = await seedOrderWithClient(a.client, aStore, [{ product_id: m1!, quantity: 3 }, { product_id: null, name: "Typed Export Med", quantity: 2, unit: "box" }]);
    const confirmed = await seedConfirmedOrder(a.client, aStore, [{ product_id: m1!, quantity: 4 }]);
    aOrders = [draft.orderId, confirmed.orderId];
    const bStore = await seedStoreWithClient(b.client, "Beta Export Store");
    await seedOrderWithClient(b.client, bStore, [{ product_id: null, name: "Beta Typed", quantity: 1, unit: "strip" }]);
  }, 120_000);

  afterAll(async () => {
    await Promise.all([a && deleteTenant(a), b && deleteTenant(b)]);
  }, 60_000);

  it("returns the caller's own stores and orders with their lines, typed lines exactly as typed", async () => {
    const page = await exportPage(a.client, 200, undefined);
    expect(page.next_cursor).toBeNull();
    expect(page.stores.map((s) => s.name)).toContain("Alpha Export Store");
    expect(page.stores.map((s) => s.name)).not.toContain("Beta Export Store");
    expect(page.orders.map((o) => o.id).sort()).toEqual([...aOrders].sort());
    const draft = page.orders.find((o) => o.id === aOrders[0])!;
    expect(draft.status).toBe("draft");
    expect(draft.lines).toHaveLength(2);
    expect(draft.lines[0]).toMatchObject({ name: "Export Med", strength: "500 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "Acme", quantity: 3 });
    expect(draft.lines[1]).toMatchObject({ product_id: null, name: "Typed Export Med", quantity: 2, unit: "box" });
    expect(draft.lines.map((l) => l.position)).toEqual([...draft.lines.map((l) => l.position)].sort((x, y) => x - y));
  });

  it("never returns a price, snapshot, cost, balance or invoice value, even for a confirmed order", async () => {
    const page = await exportPage(a.client, 200, undefined);
    expect(priceLeaks(page)).toEqual([]);
    const confirmed = page.orders.find((o) => o.id === aOrders[1])!;
    expect(confirmed.status).toBe("confirmed");
    expect(Object.keys(confirmed.lines[0]!).sort()).toEqual(
      ["delivered_quantity", "dosage_form", "id", "manufacturer", "name", "pack_size", "position", "product_id", "quantity", "strength", "unit"].sort(),
    );
  });

  it("does not show one business to the other", async () => {
    const mine = await exportPage(b.client, 200, undefined);
    expect(mine.orders.flatMap((o) => o.lines.map((l) => l.name))).toEqual(["Beta Typed"]);
    expect(JSON.stringify(mine)).not.toContain("Alpha");
    expect(JSON.stringify(mine)).not.toContain("Export Med");
    const crafted = await exportPage(b.client, 200, "0");
    expect(crafted.orders.every((o) => !aOrders.includes(o.id))).toBe(true);
  });

  it("pages with the cursor and puts the stores on the first page only", async () => {
    const store = await seedStoreWithClient(a.client, "Paging Store");
    for (let i = 0; i < 3; i += 1) await seedOrderWithClient(a.client, store, [{ product_id: null, name: `Paged ${i}`, quantity: 1, unit: "strip" }]);
    const p1 = await exportPage(a.client, 2, undefined);
    expect(p1.orders).toHaveLength(2);
    expect(p1.next_cursor).toBe("2");
    expect(p1.stores.length).toBeGreaterThan(0);
    const p2 = await exportPage(a.client, 2, p1.next_cursor!);
    expect(p2.stores).toEqual([]);
    const p3 = await exportPage(a.client, 2, p2.next_cursor ?? "4");
    const ids = [...p1.orders, ...p2.orders, ...p3.orders].map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(5);
    // oldest first
    const created = [...p1.orders, ...p2.orders, ...p3.orders].map((o) => o.created_at);
    expect(created).toEqual([...created].sort());
  });

  it("rejects an invalid cursor", async () => {
    await expect(exportPage(a.client, 10, "abc")).rejects.toThrow();
  });
});
