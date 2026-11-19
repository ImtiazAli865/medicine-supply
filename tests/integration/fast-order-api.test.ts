import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRepeatPlan, getRepeatSource, listMedicinesPage, listUsual, searchMedicines } from "@/lib/orders/fast-repository";
import { SLIM_MEDICINE_KEYS } from "@/lib/orders/fast-types";
import { bothTenants, insertMedicines, priceLeaks, seedCatalog, seedConfirmedOrder, seedOrderWithClient, seedSimilar, seedStoreWithClient } from "../helpers/fast";
import { deleteTenant, hasTestEnv, SKIP_REASON, serviceClient, type TestTenant } from "../helpers/supabase-test";

// The Module 008 read functions against the real Supabase test project with two real businesses.
// They run as the signed-in user, so Row Level Security is what isolates the businesses.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

suite("fast order entry reads (real Supabase test project)", () => {
  let a: TestTenant;
  let b: TestTenant;

  beforeAll(async () => {
    ({ a, b } = await bothTenants());
  }, 60_000);

  afterAll(async () => {
    await Promise.all([a && deleteTenant(a), b && deleteTenant(b)]);
  }, 60_000);

  describe("usual medicines and the repeat source", () => {
    it("returns an empty list and no source for a store with no confirmed order", async () => {
      const store = await seedStoreWithClient(a.client, "Empty Store");
      const draftMed = (await insertMedicines(a.client, [{ name: "Draft Only Med" }]))[0]!;
      await seedOrderWithClient(a.client, store, [{ product_id: draftMed, quantity: 1 }]); // a draft never counts
      expect(await listUsual(a.client, store)).toEqual({ usual: [], source: null });
      expect(await getRepeatSource(a.client, store)).toBeNull();
    });

    it("ranks by the number of orders, then the latest order, counts once per order, and has no price", async () => {
      const store = await seedStoreWithClient(a.client, "Ranking Store");
      const [m1, m2, m3, m4] = await insertMedicines(a.client, [
        { name: "Rank One", strength: "1 mg" },
        { name: "Rank Two", strength: "2 mg" },
        { name: "Rank Three", strength: "3 mg" },
        { name: "Rank Four", strength: "4 mg" },
      ]);
      await seedConfirmedOrder(a.client, store, [{ product_id: m1!, quantity: 3 }, { product_id: m2!, quantity: 4 }], { confirmedAt: daysAgo(30) });
      await seedConfirmedOrder(a.client, store, [{ product_id: m1!, quantity: 6, unit: "box" }, { product_id: m1!, quantity: 9 }, { product_id: m3!, quantity: 2 }], { confirmedAt: daysAgo(10) });
      await seedConfirmedOrder(a.client, store, [{ product_id: m1!, quantity: 8 }, { product_id: m4!, quantity: 1 }], { confirmedAt: daysAgo(5) });
      const { usual, source } = await listUsual(a.client, store);
      expect(usual.map((u) => u.medicine.name)).toEqual(["Rank One", "Rank Four", "Rank Three", "Rank Two"]);
      expect(usual[0]).toMatchObject({ order_count: 3, last_quantity: 8, last_unit: "strip" });
      expect(source).toMatchObject({ line_count: 2 });
      expect(priceLeaks({ usual, source })).toEqual([]);
      expect(Object.keys(usual[0]!.medicine).sort()).toEqual([...SLIM_MEDICINE_KEYS].sort());
    });

    it("ignores orders older than 180 days for the list but still offers the latest order as the source", async () => {
      const store = await seedStoreWithClient(a.client, "Old Store");
      const [m] = await insertMedicines(a.client, [{ name: "Old Order Med" }]);
      const old = await seedConfirmedOrder(a.client, store, [{ product_id: m!, quantity: 2 }], { confirmedAt: daysAgo(400) });
      const { usual, source } = await listUsual(a.client, store);
      expect(usual).toEqual([]);
      expect(source?.order_id).toBe(old.orderId);
    });

    it("does not count draft or cancelled orders and skips inactive medicines before the cut", async () => {
      const store = await seedStoreWithClient(a.client, "Cut Store");
      const defs = Array.from({ length: 14 }, (_, i) => ({ name: `Cut Med ${String(i).padStart(2, "0")}`, strength: `${i + 1} mg` }));
      const ids = await insertMedicines(a.client, defs);
      for (let i = 0; i < ids.length; i += 1) {
        await seedConfirmedOrder(a.client, store, [{ product_id: ids[i]!, quantity: 1 }], { confirmedAt: daysAgo(20 - i) });
      }
      // two of the most recent become inactive; a cancelled order of the oldest must not count
      await a.client.from("products").update({ is_active: false }).in("id", [ids[13]!, ids[12]!]);
      const cancelled = await seedConfirmedOrder(a.client, store, [{ product_id: ids[0]!, quantity: 5 }]);
      await a.client.rpc("order_cancel", { p_id: cancelled.orderId, p_request_id: randomUUID(), p_expected_version: cancelled.version, p_reason: "test" });
      const { usual } = await listUsual(a.client, store);
      expect(usual).toHaveLength(12);
      expect(usual.map((u) => u.medicine.id)).not.toContain(ids[13]);
      expect(usual.map((u) => u.medicine.id)).not.toContain(ids[12]);
      expect(usual[0]?.order_count).toBe(1);
    });

    it("never lists typed lines", async () => {
      const store = await seedStoreWithClient(a.client, "Typed Store");
      await seedConfirmedOrder(a.client, store, [{ product_id: null, name: "Some typed medicine", quantity: 2 }]);
      const { usual, source } = await listUsual(a.client, store);
      expect(usual).toEqual([]);
      expect(source?.line_count).toBe(1);
    });

    it("reads a long history across more than one page of rows and keeps the counts right", async () => {
      const store = await seedStoreWithClient(a.client, "Long History Store");
      const ids = await seedCatalog(a.client, 40);
      // 60 orders x 20 lines = 1,200 line rows (more than the 1,000-row cap of one request)
      for (let start = 0; start < 60; start += 10) {
        await Promise.all(
          Array.from({ length: 10 }, (_, k) => {
            const n = start + k;
            const lines = Array.from({ length: 20 }, (_, j) => ({ product_id: ids[(j < 2 ? j : (n + j) % 40)]!, quantity: 1 + j }));
            return seedConfirmedOrder(a.client, store, lines.filter((l, idx, all) => all.findIndex((x) => x.product_id === l.product_id) === idx), { confirmedAt: daysAgo(1 + n) });
          }),
        );
      }
      const { usual } = await listUsual(a.client, store);
      expect(usual).toHaveLength(12);
      // the two medicines in every order come first with a count of 60
      expect(usual.slice(0, 2).map((u) => u.order_count)).toEqual([60, 60]);
    }, 180_000);
  });

  describe("repeat plan", () => {
    it("returns the lines in order with quantity, unit and typed text; lists inactive and missing medicines", async () => {
      const store = await seedStoreWithClient(a.client, "Repeat Store");
      const [m1, m2] = await insertMedicines(a.client, [{ name: "Repeat One" }, { name: "Repeat Two" }]);
      const source = await seedConfirmedOrder(a.client, store, [
        { product_id: m1!, quantity: 5, unit: "strip" },
        { product_id: null, name: "Exactly  as typed", quantity: 2, unit: "box" },
        { product_id: m2!, quantity: 7, unit: "bottle" },
      ]);
      await a.client.from("products").update({ is_active: false }).eq("id", m2!);
      const plan = await getRepeatPlan(a.client, store, source.orderId);
      expect(plan.lines).toHaveLength(2);
      expect(plan.lines[0]).toMatchObject({ kind: "catalog", quantity: 5, unit: "strip", medicine: { id: m1, name: "Repeat One" } });
      expect(plan.lines[1]).toMatchObject({ kind: "typed", name: "Exactly as typed", quantity: 2, unit: "box" });
      expect(plan.skipped).toEqual([{ name: "Repeat Two", reason: "inactive" }]);
      expect(priceLeaks(plan)).toEqual([]);
    });

    it("answers 404 for an order of another store, a draft, a cancelled order and an unknown id", async () => {
      const store = await seedStoreWithClient(a.client, "Repeat Guard Store");
      const other = await seedStoreWithClient(a.client, "Other Store");
      const [m] = await insertMedicines(a.client, [{ name: "Guard Med" }]);
      const confirmed = await seedConfirmedOrder(a.client, store, [{ product_id: m!, quantity: 1 }]);
      const draft = await seedOrderWithClient(a.client, store, [{ product_id: m!, quantity: 1 }]);
      const cancelled = await seedConfirmedOrder(a.client, store, [{ product_id: m!, quantity: 1 }]);
      await a.client.rpc("order_cancel", { p_id: cancelled.orderId, p_request_id: randomUUID(), p_expected_version: cancelled.version, p_reason: "test" });
      await expect(getRepeatPlan(a.client, other, confirmed.orderId)).rejects.toMatchObject({ code: "not_found" });
      await expect(getRepeatPlan(a.client, store, draft.orderId)).rejects.toMatchObject({ code: "not_found" });
      await expect(getRepeatPlan(a.client, store, cancelled.orderId)).rejects.toMatchObject({ code: "not_found" });
      await expect(getRepeatPlan(a.client, store, randomUUID())).rejects.toMatchObject({ code: "not_found" });
    });

    it("creates one draft with all lines through the normal save, once, and leaves the source unchanged", async () => {
      const store = await seedStoreWithClient(a.client, "Apply Store");
      const [m1, m2] = await insertMedicines(a.client, [{ name: "Apply One" }, { name: "Apply Two" }]);
      const source = await seedConfirmedOrder(a.client, store, [{ product_id: m1!, quantity: 3 }, { product_id: m2!, quantity: 4 }, { product_id: null, name: "typed one", quantity: 1 }]);
      const plan = await getRepeatPlan(a.client, store, source.orderId);
      const newId = randomUUID();
      const requestId = randomUUID();
      const lines = plan.lines.map((l) => ({
        id: randomUUID(),
        product_id: l.kind === "catalog" ? l.medicine.id : null,
        name: l.kind === "typed" ? l.name : null,
        quantity: l.quantity,
        unit: l.unit,
      }));
      const args = { p_id: newId, p_request_id: requestId, p_expected_version: null, p_store_id: store, p_notes: null, p_lines: lines };
      const first = await a.client.rpc("order_save", args);
      const again = await a.client.rpc("order_save", args); // a retry or a double tap
      expect(first.data?.saved).toBe(true);
      expect(again.data?.order?.id).toBe(newId);
      const list = await a.client.from("orders").select("id,status").eq("store_id", store);
      expect((list.data ?? []).filter((o) => o.status === "draft")).toHaveLength(1);
      const created = await a.client.from("order_lines").select("id").eq("order_id", newId).is("removed_at", null);
      expect(created.data).toHaveLength(3);
      const sourceNow = await a.client.from("orders").select("status,version").eq("id", source.orderId).single();
      expect(sourceNow.data).toMatchObject({ status: "confirmed" });
    });

    it("rejects a malformed order or store id before reading anything", async () => {
      await expect(getRepeatPlan(a.client, "not-a-uuid", "also-not")).rejects.toBeTruthy();
    });
  });

  describe("medicines (slim, paged, search)", () => {
    it("pages a catalog of more than 1,000 medicines with no gap, no repeat, in name then id order, active only", async () => {
      await seedCatalog(a.client, 2300, "Paged Med");
      await insertMedicines(a.client, [{ name: "Inactive Aaa", is_active: false }]);
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await listMedicinesPage(a.client, 900, cursor);
        seen.push(...page.items.map((m) => m.id));
        cursor = page.next_cursor ?? undefined;
        pages += 1;
        expect(page.items.length).toBeLessThanOrEqual(900);
      } while (cursor);
      expect(pages).toBeGreaterThanOrEqual(3);
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen.length).toBeGreaterThanOrEqual(2300);
      const first = await listMedicinesPage(a.client, 900, undefined);
      expect(first.items.some((m) => m.name === "Inactive Aaa")).toBe(false);
      const names = first.items.map((m) => m.name);
      expect(names).toEqual([...names].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
    }, 180_000);

    it("returns exactly the slim keys and no price even though the medicines have purchase price and MRP", async () => {
      const page = await listMedicinesPage(a.client, 50, undefined);
      expect(page.items.length).toBeGreaterThan(0);
      for (const item of page.items) expect(Object.keys(item).sort()).toEqual([...SLIM_MEDICINE_KEYS].sort());
      expect(priceLeaks(page)).toEqual([]);
      expect(JSON.stringify(page)).not.toMatch(/31\.00|60\.00/); // the seeded purchase price and MRP values
    });

    it("searches with the same word rules and at most 30 rows", async () => {
      const ids = await seedSimilar(a.client);
      const all = await searchMedicines(a.client, "panadol", 30, undefined);
      expect(all.items.map((m) => m.id).sort()).toEqual(Object.values(ids).sort());
      const narrow = await searchMedicines(a.client, "panadol 500 syrup", 30, undefined);
      expect(narrow.items.map((m) => m.id)).toEqual([ids.p500s]);
      const many = await searchMedicines(a.client, "medicine", 30, undefined);
      expect(many.items).toHaveLength(30);
      expect(many.next_cursor).not.toBeNull();
      const none = await searchMedicines(a.client, "zzzz-no-such", 30, undefined);
      expect(none.items).toEqual([]);
      // wildcard characters in the text are matched literally
      const wildcard = await searchMedicines(a.client, "%", 30, undefined);
      expect(wildcard.items).toEqual([]);
    });

    it("rejects a bad cursor", async () => {
      await expect(listMedicinesPage(a.client, 10, "abc")).rejects.toMatchObject({ code: "validation_error" });
    });
  });

  describe("isolation between two businesses", () => {
    it("shows each business only its own medicines, usual lists and repeat plans, even with the same names", async () => {
      const storeA = await seedStoreWithClient(a.client, "Same Name Pharmacy");
      const storeB = await seedStoreWithClient(b.client, "Same Name Pharmacy");
      const [medA] = await insertMedicines(a.client, [{ name: "Shared Name Med", strength: "10 mg" }]);
      const [medB] = await insertMedicines(b.client, [{ name: "Shared Name Med", strength: "10 mg" }]);
      const orderA = await seedConfirmedOrder(a.client, storeA, [{ product_id: medA!, quantity: 11 }]);
      const orderB = await seedConfirmedOrder(b.client, storeB, [{ product_id: medB!, quantity: 22 }]);

      const usualA = await listUsual(a.client, storeA);
      const usualB = await listUsual(b.client, storeB);
      expect(usualA.usual.map((u) => u.medicine.id)).toEqual([medA]);
      expect(usualB.usual.map((u) => u.medicine.id)).toEqual([medB]);
      expect(usualA.usual[0]?.last_quantity).toBe(11);
      expect(usualB.usual[0]?.last_quantity).toBe(22);

      // crafted ids: the other business's store and order look like missing ones and change nothing
      expect(await listUsual(b.client, storeA)).toEqual({ usual: [], source: null });
      expect(await getRepeatSource(b.client, storeA)).toBeNull();
      await expect(getRepeatPlan(b.client, storeA, orderA.orderId)).rejects.toMatchObject({ code: "not_found" });
      await expect(getRepeatPlan(a.client, storeB, orderB.orderId)).rejects.toMatchObject({ code: "not_found" });

      const searchB = await searchMedicines(b.client, "shared name", 30, undefined);
      expect(searchB.items.map((m) => m.id)).toEqual([medB]);
      const pageA = await listMedicinesPage(a.client, 900, undefined);
      expect(pageA.items.map((m) => m.id)).not.toContain(medB);

      for (const value of [usualA, usualB, searchB, pageA]) expect(priceLeaks(value)).toEqual([]);

      // nothing changed in either business
      const admin = serviceClient();
      const orders = await admin.from("orders").select("id").in("id", [orderA.orderId, orderB.orderId]);
      expect(orders.data).toHaveLength(2);
    });
  });
});
