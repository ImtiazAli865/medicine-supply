import { describe, expect, it } from "vitest";
import { MemoryDeviceStorage } from "../helpers/memory-storage";
import { answerLocal } from "@/lib/device/local-api";
import type { BusinessDatabase, DraftRecord, StoredMedicine } from "@/lib/device/schema";
import { runSearch, normalizeRow } from "@/lib/orders/fast-search";
import type { MedicinePage, UsualResponse } from "@/lib/orders/fast-types";
import type { Order } from "@/lib/orders/types";

const BIZ = "123e4567-e89b-42d3-a456-426614174000";

function med(i: number, name = `Medicine ${i}`, strength = "500 mg"): StoredMedicine {
  return { id: `m${String(i).padStart(5, "0")}`, name, unit: "strip", brand: null, generic_name: null, strength, dosage_form: "tablet", manufacturer: "Acme", pack_size: "10", sku: null, selling_price: "12.00" };
}

async function setup(count = 0): Promise<BusinessDatabase> {
  const storage = new MemoryDeviceStorage();
  const r = await storage.openBusiness(BIZ);
  if (!r.ok) throw new Error("open failed");
  const meds = Array.from({ length: count }, (_, i) => med(i));
  await r.db.replaceMedicines(meds, "T1");
  return r.db;
}

function draft(partial: Partial<DraftRecord> & { orderId: string }): DraftRecord {
  return {
    rev: 1,
    seq: 1,
    state: { storeId: "s1", notes: "", lines: [{ id: "l1", product_id: null, name: "Typed", quantity: 2, unit: "strip" }] },
    lineInfo: {},
    baseVersion: null,
    inflight: null,
    serverOrder: null,
    syncState: "on_device",
    reason: null,
    conflict: null,
    tries: 0,
    nextTryTick: 0,
    neverSent: true,
    updatedOnDevice: "10:00",
    ...partial,
  };
}

describe("local answers", () => {
  it("pages the medicine list with the same cursor rules as the route", async () => {
    const db = await setup(2_000);
    const first = (await answerLocal(db, "GET", "/api/orders/medicines?limit=900"))!;
    expect(first.status).toBe(200);
    const p1 = first.body as MedicinePage;
    expect(p1.items.length).toBe(900);
    expect(p1.next_cursor).toBe("900");
    const p2 = (await answerLocal(db, "GET", `/api/orders/medicines?limit=900&cursor=${p1.next_cursor}`))!.body as MedicinePage;
    const p3 = (await answerLocal(db, "GET", `/api/orders/medicines?limit=900&cursor=${p2.next_cursor}`))!.body as MedicinePage;
    expect(p2.items.length).toBe(900);
    expect(p3.items.length).toBe(200);
    expect(p3.next_cursor).toBeNull();
    const ids = [...p1.items, ...p2.items, ...p3.items].map((m) => m.id);
    expect(new Set(ids).size).toBe(2_000);
    // ordered by name, then id (the same order as the route)
    const byName = [...Array.from({ length: 2_000 }, (_, i) => ({ id: `m${String(i).padStart(5, "0")}`, name: `Medicine ${i}` }))].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
    expect(ids).toEqual(byName.map((m) => m.id));
  });

  it("answers a search like runSearch on the same rows, at most 30, with a next cursor when more match", async () => {
    const storage = new MemoryDeviceStorage();
    const r = await storage.openBusiness(BIZ);
    if (!r.ok) throw new Error("x");
    const rows = [med(1, "Panadol", "500 mg"), med(2, "Panadol", "1000 mg"), ...Array.from({ length: 40 }, (_, i) => med(100 + i, `Panacea ${i}`))];
    await r.db.replaceMedicines(rows, "T1");
    const answer = (await answerLocal(r.db, "GET", "/api/orders/medicines?q=panadol%20500&limit=30"))!.body as MedicinePage;
    expect(answer.items.map((m) => m.id)).toEqual(runSearch(rows.map(normalizeRow), "panadol 500").results.map((m) => m.id));
    expect(answer.items.length).toBe(1);
    const many = (await answerLocal(r.db, "GET", "/api/orders/medicines?q=pana&limit=30"))!.body as MedicinePage;
    expect(many.items.length).toBe(30);
    expect(many.next_cursor).toBe("30");
    const next = (await answerLocal(r.db, "GET", "/api/orders/medicines?q=pana&limit=30&cursor=30"))!.body as MedicinePage;
    expect(next.items.length).toBe(12);
    expect(next.next_cursor).toBeNull();
  });

  it("returns no price field other than the selling price", async () => {
    const db = await setup(3);
    const page = (await answerLocal(db, "GET", "/api/orders/medicines?limit=900"))!.body as MedicinePage;
    expect(JSON.stringify(page)).not.toMatch(/purchase|mrp|cost/i);
  });

  it("answers usual and repeat from the saved store data and says when a store is not saved", async () => {
    const db = await setup(0);
    const usual: UsualResponse = { usual: [], source: { order_id: "o1", order_number: 5, confirmed_at: "2026-11-01T00:00:00Z", line_count: 2 } };
    await db.put("storeExtras", { storeId: "s1", usual, repeatPlan: { lines: [], skipped: [] }, updatedAt: "T" });
    expect((await answerLocal(db, "GET", "/api/orders/usual?store_id=s1"))!.body).toEqual(usual);
    expect((await answerLocal(db, "GET", "/api/orders/repeat?store_id=s1&order_id=o1"))!.body).toEqual({ lines: [], skipped: [] });
    const missing = (await answerLocal(db, "GET", "/api/orders/usual?store_id=s9"))!;
    expect(missing.status).toBe(503);
    expect(JSON.stringify(missing.body)).toContain("not saved on this phone yet");
    const wrongOrder = (await answerLocal(db, "GET", "/api/orders/repeat?store_id=s1&order_id=other"))!;
    expect(wrongOrder.status).toBe(503);
  });

  it("lists stores, filters by search, and includes stores made on the device", async () => {
    const db = await setup(0);
    await db.replaceStores(
      [
        { id: "s1", name: "Alpha Pharmacy", contact_person: null, phone: null, address: null, is_active: true, pending: false },
        { id: "s2", name: "Beta Medical", contact_person: null, phone: null, address: null, is_active: true, pending: false },
        { id: "s3", name: "Gone Store", contact_person: null, phone: null, address: null, is_active: false, pending: false },
      ],
      "T1",
    );
    await db.put("stores", { id: "s4", name: "Made Offline", contact_person: null, phone: null, address: null, is_active: true, pending: true });
    const all = (await answerLocal(db, "GET", "/api/stores?status=active&limit=100"))!.body as { items: Array<{ id: string }>; next_cursor: string | null };
    expect(all.items.map((s) => s.id)).toEqual(["s1", "s2", "s4"]);
    const q = (await answerLocal(db, "GET", "/api/stores?status=active&q=beta"))!.body as { items: Array<{ id: string }> };
    expect(q.items.map((s) => s.id)).toEqual(["s2"]);
    const one = (await answerLocal(db, "GET", "/api/stores/s4"))!;
    expect(one.status).toBe(200);
    expect((await answerLocal(db, "GET", "/api/stores/nope"))!.status).toBe(404);
  });

  it("answers a draft that has a server copy, and says not found for a never-sent order", async () => {
    const db = await setup(0);
    const server = { id: "o1", order_number: 7, status: "draft", version: 3, lines: [], store: { id: "s1", name: "S", is_active: true } } as unknown as Order;
    await db.put("drafts", draft({ orderId: "o1", serverOrder: server, baseVersion: 3, neverSent: false, syncState: "synced" }));
    await db.put("drafts", draft({ orderId: "o2" }));
    expect((await answerLocal(db, "GET", "/api/orders/o1"))!.body).toEqual(server);
    expect((await answerLocal(db, "GET", "/api/orders/o2"))!.status).toBe(404);
    expect((await answerLocal(db, "GET", "/api/orders/none"))!.status).toBe(404);
  });

  it("lists only the drafts that are not yet on the server, newest first, flagged as device orders", async () => {
    const db = await setup(0);
    await db.put("drafts", draft({ orderId: "a", seq: 1 }));
    await db.put("drafts", draft({ orderId: "b", seq: 2, syncState: "waiting" }));
    await db.put("drafts", draft({ orderId: "c", seq: 3, syncState: "synced", neverSent: false }));
    const list = (await answerLocal(db, "GET", "/api/orders?limit=50"))!.body as { items: Array<{ id: string; device: { neverSent: boolean; syncState: string } }> };
    expect(list.items.map((i) => i.id)).toEqual(["b", "a"]);
    expect(list.items[0]!.device).toEqual({ syncState: "waiting", neverSent: true });
    const confirmed = (await answerLocal(db, "GET", "/api/orders?status=confirmed"))!.body as { items: unknown[] };
    expect(confirmed.items).toEqual([]);
  });

  it("answers nothing for other paths, other methods, or without a database", async () => {
    const db = await setup(1);
    expect(await answerLocal(db, "GET", "/api/invoices")).toBeNull();
    expect(await answerLocal(db, "GET", "/api/accounts/summary")).toBeNull();
    expect(await answerLocal(db, "PUT", "/api/orders/o1")).toBeNull();
    expect(await answerLocal(db, "POST", "/api/stores")).toBeNull();
    expect(await answerLocal(null, "GET", "/api/orders/medicines")).toBeNull();
  });
});
