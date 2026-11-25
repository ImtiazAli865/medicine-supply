import { describe, expect, it } from "vitest";
import { MemoryDeviceStorage } from "../helpers/memory-storage";
import type { DraftRecord, PaymentOpRecord, StoredMedicine, StoredStore } from "@/lib/device/schema";

const BIZ_A = "123e4567-e89b-42d3-a456-426614174000";
const BIZ_B = "123e4567-e89b-42d3-a456-426614174001";

function draft(orderId: string, rev: number, seq = 1): DraftRecord {
  return {
    orderId,
    rev,
    seq,
    state: { storeId: "s1", notes: "", lines: [] },
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
  };
}

function payment(paymentId: string, seq: number): PaymentOpRecord {
  return {
    paymentId,
    rev: 1,
    seq,
    storeId: "s1",
    amount: "5000.00",
    date: "2026-11-24",
    reference: null,
    state: "on_device",
    reason: null,
    conflict: null,
    attempted: false,
    tries: 0,
    nextTryTick: 0,
    recordedOn: "10:00",
  };
}

function medicine(id: string, name = id): StoredMedicine {
  return { id, name, unit: "strip", brand: null, generic_name: null, strength: null, dosage_form: null, manufacturer: null, pack_size: null, sku: null, selling_price: null };
}

function store(id: string, pending = false): StoredStore {
  return { id, name: id, contact_person: null, phone: null, address: null, is_active: true, pending };
}

async function open(storage: MemoryDeviceStorage, id = BIZ_A) {
  const result = await storage.openBusiness(id);
  if (!result.ok) throw new Error("open failed");
  return result.db;
}

describe("DeviceStorage contract (in-memory implementation)", () => {
  it("copies records in and out like IndexedDB", async () => {
    const storage = new MemoryDeviceStorage();
    const db = await open(storage);
    const d = draft("o1", 1);
    await db.put("drafts", d);
    d.state.notes = "changed after the write";
    const read = await db.get("drafts", "o1");
    expect(read?.state.notes).toBe("");
    read!.state.notes = "changed after the read";
    expect((await db.get("drafts", "o1"))?.state.notes).toBe("");
  });

  it("refuses a draft write whose rev is stale and changes nothing", async () => {
    const storage = new MemoryDeviceStorage();
    const db = await open(storage);
    expect(await db.putDraftIfRev(draft("o1", 1), null)).toEqual({ ok: true });
    expect(await db.putDraftIfRev(draft("o1", 2), 1)).toEqual({ ok: true });
    const stale = await db.putDraftIfRev({ ...draft("o1", 2), reason: "second tab" }, 1);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.stored?.rev).toBe(2);
    expect((await db.get("drafts", "o1"))?.reason).toBeNull();
    // creating a draft that already exists is also refused
    expect((await db.putDraftIfRev(draft("o1", 1), null)).ok).toBe(false);
  });

  it("applies a batch all or nothing", async () => {
    const storage = new MemoryDeviceStorage();
    const db = await open(storage);
    await db.put("drafts", draft("keep", 1));
    storage.failAfterWrites = 2;
    await expect(
      db.batch([
        { op: "put", store: "drafts", value: draft("a", 1) },
        { op: "put", store: "drafts", value: draft("b", 1) },
        { op: "remove", store: "drafts", key: "keep" },
      ]),
    ).rejects.toThrow();
    expect((await db.getAll("drafts")).map((d) => d.orderId)).toEqual(["keep"]);
    await db.batch([
      { op: "put", store: "drafts", value: draft("a", 1) },
      { op: "remove", store: "drafts", key: "keep" },
    ]);
    expect((await db.getAll("drafts")).map((d) => d.orderId)).toEqual(["a"]);
  });

  it("replaces the medicine list in one step and never shows a half-written list", async () => {
    const storage = new MemoryDeviceStorage();
    const db = await open(storage);
    await db.replaceMedicines([medicine("m1"), medicine("m2")], "T1");
    storage.failAfterWrites = 2;
    await expect(db.replaceMedicines([medicine("n1"), medicine("n2"), medicine("n3")], "T2")).rejects.toThrow();
    expect((await db.getAll("medicines")).map((m) => m.id).sort()).toEqual(["m1", "m2"]);
    expect((await db.get("meta", "medicinesUpdatedAt"))?.value).toBe("T1");
    await db.replaceMedicines([medicine("n1")], "T3");
    expect((await db.getAll("medicines")).map((m) => m.id)).toEqual(["n1"]);
    expect((await db.get("meta", "medicinesUpdatedAt"))?.value).toBe("T3");
  });

  it("replaces the server stores but keeps stores made on this device that are still pending", async () => {
    const storage = new MemoryDeviceStorage();
    const db = await open(storage);
    await db.replaceStores([store("s1"), store("s2")], "T1");
    await db.put("stores", store("local", true));
    await db.replaceStores([store("s2"), store("s3")], "T2");
    expect((await db.getAll("stores")).map((s) => s.id).sort()).toEqual(["local", "s2", "s3"]);
  });

  it("keeps one business's data away from another and leaves them alone when one is deleted", async () => {
    const storage = new MemoryDeviceStorage();
    const a = await open(storage, BIZ_A);
    const b = await open(storage, BIZ_B);
    await a.put("drafts", draft("o1", 1));
    await b.put("drafts", draft("o2", 1));
    await storage.putRegistryEntry({ userId: "u1", businessId: BIZ_A, businessName: "A", lastSignedInAt: "T" });
    expect((await a.getAll("drafts")).map((d) => d.orderId)).toEqual(["o1"]);
    expect((await b.getAll("drafts")).map((d) => d.orderId)).toEqual(["o2"]);
    await storage.deleteBusiness(BIZ_A);
    expect(storage.hasBusiness(BIZ_A)).toBe(false);
    expect((await (await open(storage, BIZ_B)).getAll("drafts")).map((d) => d.orderId)).toEqual(["o2"]);
    expect(await storage.getRegistryEntry("u1")).toBeDefined();
  });

  it("keeps the registry apart from business data", async () => {
    const storage = new MemoryDeviceStorage();
    await storage.putRegistryEntry({ userId: "u1", businessId: BIZ_A, businessName: "A", lastSignedInAt: "T" });
    await storage.putRegistryEntry({ userId: "u2", businessId: BIZ_B, businessName: "B", lastSignedInAt: "T" });
    expect((await storage.listRegistry()).map((e) => e.userId).sort()).toEqual(["u1", "u2"]);
    await storage.removeRegistryEntry("u1");
    expect(await storage.getRegistryEntry("u1")).toBeUndefined();
  });

  it("reports unavailable storage and a newer schema as plain results, not exceptions", async () => {
    const storage = new MemoryDeviceStorage();
    storage.available = false;
    const result = await storage.openBusiness(BIZ_A);
    expect(result.ok).toBe(false);
    storage.available = true;
    storage.newerSchemaFor.add(`medsupply-${BIZ_A}`);
    const newer = await storage.openBusiness(BIZ_A);
    expect(newer.ok === false && newer.reason).toBe("newer_schema");
  });

  it("keeps waiting payments in their own store: put, get, getAll, remove and batch", async () => {
    const storage = new MemoryDeviceStorage();
    const db = await open(storage);
    await db.put("paymentOps", payment("p1", 1));
    await db.put("paymentOps", payment("p2", 2));
    expect((await db.get("paymentOps", "p1"))?.amount).toBe("5000.00");
    expect((await db.getAll("paymentOps")).map((p) => p.paymentId).sort()).toEqual(["p1", "p2"]);
    expect(await db.getAll("drafts")).toEqual([]);
    await db.put("paymentOps", { ...payment("p1", 1), rev: 2, state: "waiting" });
    expect((await db.getAll("paymentOps")).length).toBe(2);
    await db.batch([
      { op: "put", store: "paymentOps", value: payment("p3", 3) },
      { op: "remove", store: "paymentOps", key: "p1" },
      { op: "put", store: "drafts", value: draft("o1", 1) },
    ]);
    expect((await db.getAll("paymentOps")).map((p) => p.paymentId).sort()).toEqual(["p2", "p3"]);
    await db.remove("paymentOps", "p2");
    expect((await db.getAll("paymentOps")).map((p) => p.paymentId)).toEqual(["p3"]);
  });

  it("keeps one business's waiting payments away from another's, and applies a payment batch all or nothing", async () => {
    const storage = new MemoryDeviceStorage();
    const a = await open(storage, BIZ_A);
    const b = await open(storage, BIZ_B);
    await a.put("paymentOps", payment("pa", 1));
    await b.put("paymentOps", payment("pb", 1));
    expect((await a.getAll("paymentOps")).map((p) => p.paymentId)).toEqual(["pa"]);
    expect((await b.getAll("paymentOps")).map((p) => p.paymentId)).toEqual(["pb"]);
    storage.failAfterWrites = 2;
    await expect(
      a.batch([
        { op: "put", store: "paymentOps", value: payment("x1", 2) },
        { op: "put", store: "paymentOps", value: payment("x2", 3) },
      ]),
    ).rejects.toThrow();
    expect((await a.getAll("paymentOps")).map((p) => p.paymentId)).toEqual(["pa"]);
  });

  it("copies a waiting payment in and out like IndexedDB", async () => {
    const storage = new MemoryDeviceStorage();
    const db = await open(storage);
    const p = payment("p1", 1);
    await db.put("paymentOps", p);
    p.amount = "1.00";
    const read = await db.get("paymentOps", "p1");
    expect(read?.amount).toBe("5000.00");
    read!.amount = "2.00";
    expect((await db.get("paymentOps", "p1"))?.amount).toBe("5000.00");
  });

  it("fails writes when the storage is full and keeps the old data", async () => {
    const storage = new MemoryDeviceStorage();
    const db = await open(storage);
    await db.put("drafts", draft("o1", 1));
    storage.failWrites = true;
    await expect(db.put("drafts", draft("o2", 1))).rejects.toThrow();
    expect((await db.getAll("drafts")).map((d) => d.orderId)).toEqual(["o1"]);
  });
});
