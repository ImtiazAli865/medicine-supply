import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listOrders } from "@/lib/orders/repository";
import { OrderListQuerySchema } from "@/lib/validation/order";
import { seedWithClient, type Seeded } from "../helpers/orders";
import { createTenant, deleteTenant, hasTestEnv, serviceClient, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// The history list over the real stack with 1,000 orders (SC-010): every filter returns the right subset,
// paging never repeats or skips, and the first page opens within 2 seconds. The orders are seeded with the
// service role in this test only (never in src/); the list itself runs as the signed-in user.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const query = (q: Record<string, unknown>) => OrderListQuerySchema.parse(q);

suite("order history against Supabase", () => {
  let a: TestTenant;
  let seed: Seeded;
  let store2: string;
  const BASE = Date.UTC(2026, 9, 1, 12, 0, 0); // 1 Oct 2026, 12:00 UTC

  beforeAll(async () => {
    a = await createTenant("orders-history");
    seed = await seedWithClient(a.client);
    store2 = randomUUID();
    await a.client.from("stores").insert({ id: store2, name: "Second Store" });

    const admin = serviceClient();
    const orders = Array.from({ length: 1000 }, (_, i) => {
      const n = i + 1;
      const status = n % 10 === 0 ? "cancelled" : n % 3 === 0 ? "confirmed" : "draft";
      const createdAt = new Date(BASE + n * 60 * 60 * 1000).toISOString(); // one per hour
      return {
        id: randomUUID(),
        business_id: a.businessId,
        store_id: n % 2 === 0 ? store2 : seed.storeId,
        order_number: n,
        status,
        created_at: createdAt,
        confirmed_at: status === "confirmed" ? createdAt : null,
        cancelled_at: status === "cancelled" ? createdAt : null,
      };
    });
    for (let i = 0; i < orders.length; i += 250) {
      const { error } = await admin.from("orders").insert(orders.slice(i, i + 250));
      if (error) throw new Error(`seed orders failed: ${error.message}`);
    }
  }, 180_000);
  afterAll(async () => {
    await deleteTenant(a);
  }, 120_000);

  it("opens the first page within 2 seconds with 1,000 orders, newest first", async () => {
    const started = performance.now();
    const page = await listOrders(a.client, query({ limit: "30" }));
    const elapsed = performance.now() - started;
    console.log(`orders history: first page of 30 from 1,000 orders took ${Math.round(elapsed)} ms`);
    expect(elapsed, `first page took ${Math.round(elapsed)} ms`).toBeLessThan(2000);
    expect(page.items).toHaveLength(30);
    expect(page.items[0].order_number).toBe(1000);
    expect(page.items.map((o) => o.order_number)).toEqual(Array.from({ length: 30 }, (_, i) => 1000 - i));
    expect(page.next_cursor).toBe("30");
  });

  it("pages through all 1,000 orders without repeats or gaps", async () => {
    const seen = new Set<string>();
    const numbers: number[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listOrders(a.client, query({ limit: "100", cursor }));
      for (const o of page.items) {
        seen.add(o.id);
        numbers.push(o.order_number);
      }
      cursor = page.next_cursor ?? undefined;
      pages++;
    } while (cursor && pages < 20);
    expect(seen.size).toBe(1000);
    expect(numbers).toEqual(Array.from({ length: 1000 }, (_, i) => 1000 - i));
  });

  it("filters by store, by status, and by both", async () => {
    const store = await listOrders(a.client, query({ store_id: store2, limit: "100" }));
    expect(store.items.every((o) => o.store.id === store2)).toBe(true);
    expect(store.items).toHaveLength(100);
    const cancelled = await listOrders(a.client, query({ status: "cancelled", limit: "100" }));
    expect(cancelled.items).toHaveLength(100);
    expect(cancelled.items.every((o) => o.status === "cancelled")).toBe(true);
    const both = await listOrders(a.client, query({ store_id: seed.storeId, status: "confirmed", limit: "100" }));
    // confirmed = multiples of 3 that are not multiples of 10; the first store has the odd numbers
    const expected = Array.from({ length: 1000 }, (_, i) => i + 1).filter((n) => n % 3 === 0 && n % 10 !== 0 && n % 2 === 1);
    expect(both.items.map((o) => o.order_number)).toEqual(expected.reverse().slice(0, 100));
  });

  it("filters by Pakistan day: orders are one per hour, so one local day holds 24 of them", async () => {
    // BASE + n hours = 1 Oct 2026 12:00 UTC + n h = 17:00 Pakistan time + n h. Local day 2 Oct 2026 starts at n = 7 (00:00 PKT).
    const day = await listOrders(a.client, query({ from: "2026-10-02", to: "2026-10-02", limit: "100" }));
    expect(day.items).toHaveLength(24);
    expect(day.items.map((o) => o.order_number)).toEqual(Array.from({ length: 24 }, (_, i) => 30 - i));
    const earlier = await listOrders(a.client, query({ to: "2026-10-01", limit: "100" }));
    expect(earlier.items.map((o) => o.order_number)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it("searches by order number and by store name", async () => {
    const number = await listOrders(a.client, query({ q: "ORD-0777" }));
    expect(number.items.map((o) => o.order_number)).toEqual([777]);
    const byHash = await listOrders(a.client, query({ q: "#500", limit: "100" }));
    expect(byHash.items.map((o) => o.order_number)).toContain(500);
    const byStore = await listOrders(a.client, query({ q: "second store", limit: "100" }));
    expect(byStore.items).toHaveLength(100);
    expect(byStore.items.every((o) => o.store.name === "Second Store")).toBe(true);
    expect((await listOrders(a.client, query({ q: "no such thing" }))).items).toEqual([]);
  });
});
