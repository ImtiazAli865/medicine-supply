import { describe, expect, it } from "vitest";
import { MemoryDeviceStorage } from "../helpers/memory-storage";
import { buildBackupFile, fetchAllExportPages, loadDeviceSnapshot, loadServerSnapshot } from "@/lib/backup/client";
import type { ExportPage } from "@/lib/backup/export-repository";
import { findForbiddenKeys, parseBackup, serializeBackup } from "@/lib/backup/file";
import { emptyDraft, Journal } from "@/lib/device/journal";
import type { BusinessDatabase, StoreOpRecord } from "@/lib/device/schema";

const BIZ = "123e4567-e89b-42d3-a456-426614174000";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const O1 = "11111111-1111-4111-8111-111111111111";
const O2 = "22222222-2222-4222-8222-222222222222";
const L1 = "00000000-0000-4000-8000-000000000001";

async function openDb(): Promise<BusinessDatabase> {
  const r = await new MemoryDeviceStorage().openBusiness(BIZ);
  if (!r.ok) throw new Error("open failed");
  return r.db;
}

function order(id: string) {
  return {
    id,
    order_number: 1,
    status: "draft" as const,
    source: "manual" as const,
    notes: null,
    version: 2,
    store_id: S1,
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-02T10:00:00Z",
    confirmed_at: null,
    cancelled_at: null,
    cancel_reason: null,
    lines: [{ id: L1, position: 1, product_id: null, name: "Typed", strength: null, dosage_form: null, pack_size: null, manufacturer: null, quantity: 2, unit: "box", delivered_quantity: null }],
  };
}

function pages(): { fetchPage: (cursor: string | null) => Promise<ExportPage>; calls: Array<string | null> } {
  const calls: Array<string | null> = [];
  const data: ExportPage[] = [
    { exported_at: "T", stores: [{ id: S1, name: "Alpha", contact_person: null, phone: null, address: null, is_active: true }], orders: [order(O1)], next_cursor: "1" },
    { exported_at: "T", stores: [], orders: [order(O2)], next_cursor: null },
  ];
  return {
    calls,
    fetchPage: async (cursor) => {
      calls.push(cursor);
      return data[cursor === null ? 0 : 1]!;
    },
  };
}

describe("backup from the phone", () => {
  it("reads every page of the server export, stores from the first page only", async () => {
    const p = pages();
    const all = await fetchAllExportPages(p.fetchPage);
    expect(p.calls).toEqual([null, "1"]);
    expect(all.stores.map((s) => s.id)).toEqual([S1]);
    expect(all.orders.map((o) => o.id)).toEqual([O1, O2]);
  });

  it("builds a server+device file with the waiting orders and stores, clean of any price or secret", async () => {
    const db = await openDb();
    const draft = emptyDraft("33333333-3333-4333-8333-333333333333", { storeId: S1, notes: "", lines: [{ id: L1, product_id: null, name: "Waiting Typed", quantity: 1, unit: "strip" }] }, {}, "10:00");
    await new Journal(db).apply(draft.orderId, null, () => draft);
    const op: StoreOpRecord = { storeId: S2, rev: 1, seq: 1, payload: { id: S2, name: "Made Offline", contact_person: null, phone: null, address: null, notes: null }, confirmDuplicate: false, state: "on_device", reason: null, matches: [], tries: 0, nextTryTick: 0 };
    await db.put("storeOps", op);
    const file = await buildBackupFile({ db, businessId: BIZ, now: () => "2026-11-21T08:00:00.000Z", fetchPage: pages().fetchPage });
    expect(file.source).toBe("server+device");
    expect(file.counts).toEqual({ stores: 1, orders: 2, lines: 2, waitingOrders: 1, waitingStores: 1, waitingPayments: 0 });
    expect(findForbiddenKeys(file)).toEqual([]);
    const parsed = parseBackup(serializeBackup(file), BIZ);
    expect(parsed.ok).toBe(true);
  });

  it("makes a device-only file offline and says so, with the stores this phone knows and the waiting items", async () => {
    const db = await openDb();
    await db.put("stores", { id: S1, name: "Alpha", contact_person: null, phone: null, address: null, is_active: true, pending: false });
    const draft = emptyDraft(O1, { storeId: S1, notes: "", lines: [{ id: L1, product_id: null, name: "Only Here", quantity: 1, unit: "strip" }] }, {}, "10:00");
    await new Journal(db).apply(O1, null, () => draft);
    const file = await buildBackupFile({ db, businessId: BIZ, now: () => "2026-11-21T08:00:00.000Z", fetchPage: null });
    expect(file.source).toBe("device-only");
    expect(file.stores.map((s) => s.id)).toEqual([S1]);
    expect(file.orders).toEqual([]);
    expect(file.waiting.orders.map((o) => o.orderId)).toEqual([O1]);
  });

  it("falls back to a device-only file when the connection fails while reading", async () => {
    const db = await openDb();
    const file = await buildBackupFile({
      db,
      businessId: BIZ,
      now: () => "2026-11-21T08:00:00.000Z",
      fetchPage: async () => {
        throw new Error("network");
      },
    });
    expect(file.source).toBe("device-only");
  });

  it("describes what the server and the phone hold for the preview", async () => {
    const server = await loadServerSnapshot(pages().fetchPage);
    expect([...server.orders.keys()]).toEqual([O1, O2]);
    expect(server.orders.get(O1)).toEqual({ version: 2, status: "draft" });
    expect([...server.stores]).toEqual([S1]);
    const db = await openDb();
    await db.put("stores", { id: S2, name: "Local", contact_person: null, phone: null, address: null, is_active: true, pending: true });
    const device = await loadDeviceSnapshot(db);
    expect([...device.stores]).toEqual([S2]);
    expect(device.drafts.size).toBe(0);
  });
});
