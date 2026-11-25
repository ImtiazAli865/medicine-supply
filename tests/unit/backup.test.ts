import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryDeviceStorage } from "../helpers/memory-storage";
import { applyImport } from "@/lib/backup/apply";
import {
  backupFileName,
  buildBackup,
  findForbiddenKeys,
  parseBackup,
  serializeBackup,
  waitingOrderFromDraft,
  waitingStoreFromOp,
  type BackupFile,
  type BackupOrder,
} from "@/lib/backup/file";
import { previewImport, type DeviceSnapshot, type ServerSnapshot } from "@/lib/backup/preview";
import { emptyDraft, Journal } from "@/lib/device/journal";
import type { BusinessDatabase, StoreOpRecord } from "@/lib/device/schema";

const BIZ = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_BIZ = "123e4567-e89b-42d3-a456-426614174999";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const O1 = "11111111-1111-4111-8111-111111111111";
const O2 = "22222222-2222-4222-8222-222222222222";
const O3 = "33333333-3333-4333-8333-333333333333";
const M1 = "44444444-4444-4444-8444-444444444444";
const L = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function order(id: string, status: BackupOrder["status"], version: number, storeId = S1): BackupOrder {
  return {
    id,
    order_number: version,
    status,
    source: "manual",
    notes: null,
    version,
    store_id: storeId,
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-02T10:00:00Z",
    confirmed_at: status === "draft" ? null : "2026-11-02T10:00:00Z",
    cancelled_at: null,
    cancel_reason: null,
    lines: [{ id: L(1), position: 0, product_id: M1, name: "Panadol", strength: "500 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK", quantity: 5, unit: "strip", delivered_quantity: null }],
  };
}

function waitingDraft(orderId: string, baseVersion: number | null) {
  const d = emptyDraft(
    orderId,
    { storeId: S1, notes: "n", lines: [{ id: L(2), product_id: null, name: "Typed med", quantity: 3, unit: "box" }, { id: L(3), product_id: M1, name: null, quantity: 2, unit: "strip" }] },
    { [L(2)]: { name: "Typed med", typed_name: null, strength: null, dosage_form: null, pack_size: null, manufacturer: null, selling_price: null, price_basis: "none", typed: true }, [L(3)]: { name: "Panadol", typed_name: null, strength: "500 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK", selling_price: "12.00", price_basis: "current", typed: false } },
    "10:00",
  );
  d.baseVersion = baseVersion;
  d.neverSent = baseVersion === null;
  d.rev = 1;
  return d;
}

function storeOp(id: string, name: string): StoreOpRecord {
  return { storeId: id, rev: 1, seq: 1, payload: { id, name, contact_person: null, phone: "0300", address: null, notes: null }, confirmDuplicate: false, state: "on_device", reason: null, matches: [], tries: 0, nextTryTick: 0 };
}

function sample(): BackupFile {
  return buildBackup({
    businessId: BIZ,
    exportedAt: "2026-11-21T08:00:00.000Z",
    source: "server+device",
    stores: [{ id: S1, name: "Alpha Pharmacy", contact_person: null, phone: null, address: null, is_active: true }],
    orders: [order(O1, "confirmed", 3), order(O2, "draft", 2)],
    waitingOrders: [waitingOrderFromDraft(waitingDraft(O3, null))],
    waitingStores: [waitingStoreFromOp(storeOp(S2, "Made offline"))],
  });
}

const emptyServer = (): ServerSnapshot => ({ orders: new Map(), stores: new Set() });
const emptyDevice = (): DeviceSnapshot => ({ drafts: new Map(), storeOps: new Map(), stores: new Set(), payments: new Map() });

describe("backup file", () => {
  it("counts stores, orders, lines and waiting items", () => {
    const f = sample();
    expect(f.counts).toEqual({ stores: 1, orders: 2, lines: 2, waitingOrders: 1, waitingStores: 1, waitingPayments: 0 });
    expect(backupFileName(f.exportedAt)).toBe("medsupply-backup-2026-11-21.json");
  });

  it("round-trips through text and holds no price, secret or money key at any depth", () => {
    const f = sample();
    const text = serializeBackup(f);
    expect(findForbiddenKeys(JSON.parse(text))).toEqual([]);
    expect(text).not.toMatch(/selling_price|purchase|mrp|token|password|cookie|balance|invoice|ledger/i);
    const parsed = parseBackup(text, BIZ);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.file).toEqual(f);
  });

  it("keeps typed lines exactly as typed and gives catalog lines their display details", () => {
    const w = sample().waiting.orders[0]!;
    expect(w.lines[0]).toMatchObject({ product_id: null, name: "Typed med", display_name: "Typed med", quantity: 3, unit: "box" });
    expect(w.lines[1]).toMatchObject({ product_id: M1, name: null, display_name: "Panadol", strength: "500 mg", manufacturer: "GSK" });
    expect(JSON.stringify(w)).not.toContain("12.00"); // the last known price is never exported
  });

  it("matches the schema file: same top-level fields and the same enums", () => {
    const schema = JSON.parse(readFileSync(path.join(process.cwd(), "specs/009-offline-sync-backup/contracts/backup-file.schema.json"), "utf8")) as { required: string[]; properties: Record<string, unknown> };
    expect(Object.keys(sample()).sort()).toEqual([...schema.required].sort());
    expect(Object.keys(schema.properties).sort()).toEqual([...schema.required].sort());
  });

  it("refuses a damaged file, an unknown version, another business and wrong counts, each with a plain reason", () => {
    const f = sample();
    expect(parseBackup("{not json", BIZ)).toMatchObject({ ok: false, reason: "damaged" });
    expect(parseBackup(JSON.stringify({ hello: 1 }), BIZ)).toMatchObject({ ok: false, reason: "damaged" });
    expect(parseBackup(JSON.stringify({ ...f, version: 3 }), BIZ)).toMatchObject({ ok: false, reason: "unknown_version" });
    expect(parseBackup(serializeBackup(f), OTHER_BIZ)).toMatchObject({ ok: false, reason: "other_business" });
    expect(parseBackup(JSON.stringify({ ...f, counts: { ...f.counts, orders: 9 } }), BIZ)).toMatchObject({ ok: false, reason: "damaged" });
    const badQty = structuredClone(f);
    badQty.orders[0]!.lines[0]!.quantity = 0;
    expect(parseBackup(JSON.stringify(badQty), BIZ)).toMatchObject({ ok: false, reason: "damaged" });
    const tooMany = structuredClone(f);
    tooMany.orders[0]!.lines = Array.from({ length: 201 }, (_, i) => ({ ...f.orders[0]!.lines[0]!, id: L(100 + i) }));
    tooMany.counts.lines = 201 + f.orders[1]!.lines.length;
    expect(parseBackup(JSON.stringify(tooMany), BIZ)).toMatchObject({ ok: false, reason: "damaged" });
    for (const r of [parseBackup("{x", BIZ), parseBackup(serializeBackup(f), OTHER_BIZ)]) expect(!r.ok && r.message).toContain("Nothing was imported");
  });

  it("refuses a file that carries a forbidden key such as a price or a token", () => {
    const f = JSON.parse(serializeBackup(sample()));
    f.orders[0].lines[0].purchase_price = "5.00";
    expect(parseBackup(JSON.stringify(f), BIZ)).toMatchObject({ ok: false, reason: "damaged" });
    const g = JSON.parse(serializeBackup(sample()));
    g.access_token = "x";
    expect(parseBackup(JSON.stringify(g), BIZ)).toMatchObject({ ok: false, reason: "damaged" });
  });
});

describe("import preview", () => {
  it("classifies everything as new for an empty server and an empty phone, and cannot restore confirmed orders", () => {
    const preview = previewImport(sample(), emptyServer(), emptyDevice());
    const byId = (id: string) => preview.items.find((i) => i.id === id)!;
    expect(byId(O1).verdict).toBe("cannot_restore");
    expect(byId(O2).verdict).toBe("new");
    expect(byId(O3).verdict).toBe("new");
    expect(byId(S1).verdict).toBe("new");
    expect(byId(S2).verdict).toBe("new");
    expect(preview.counts).toEqual({ new: 4, already_on_server: 0, already_on_device: 0, conflict: 0, cannot_restore: 1 });
    expect(preview.canApply).toBe(true);
    expect(preview.plan.orders.map((o) => o.orderId).sort()).toEqual([O2, O3]);
  });

  it("finds what is already on the server and keeps a newer server copy as a conflict", () => {
    const server: ServerSnapshot = {
      orders: new Map([
        [O1, { version: 3, status: "confirmed" }],
        [O2, { version: 5, status: "draft" }],
      ]),
      stores: new Set([S1, S2]),
    };
    const preview = previewImport(sample(), server, emptyDevice());
    const byId = (id: string) => preview.items.find((i) => i.id === id)!;
    expect(byId(O1).verdict).toBe("already_on_server");
    expect(byId(O2).verdict).toBe("conflict");
    expect(byId(O2).reason).toContain("server copy");
    expect(byId(S1).verdict).toBe("already_on_server");
    expect(byId(O3).verdict).toBe("new");
    expect(preview.plan.orders.map((o) => o.orderId)).toEqual([O3]);
  });

  it("treats a waiting change based on an older server version as a conflict and one based on the current version as new", () => {
    const file = sample();
    file.waiting.orders[0] = { ...file.waiting.orders[0]!, baseVersion: 4, neverSent: false };
    const current = previewImport(file, { orders: new Map([[O3, { version: 4, status: "draft" }]]), stores: new Set() }, emptyDevice());
    expect(current.items.find((i) => i.id === O3)!.verdict).toBe("new");
    const newer = previewImport(file, { orders: new Map([[O3, { version: 6, status: "draft" }]]), stores: new Set() }, emptyDevice());
    expect(newer.items.find((i) => i.id === O3)!.verdict).toBe("conflict");
    const confirmed = previewImport(file, { orders: new Map([[O3, { version: 4, status: "confirmed" }]]), stores: new Set() }, emptyDevice());
    expect(confirmed.items.find((i) => i.id === O3)!.verdict).toBe("conflict");
    const missing = previewImport(file, emptyServer(), emptyDevice());
    expect(missing.items.find((i) => i.id === O3)!.verdict).toBe("conflict");
  });

  it("recognises an order that is already waiting on this phone, and a different local version as a conflict", () => {
    const file = sample();
    const same = new Map([[O3, waitingDraft(O3, null)]]);
    const preview = previewImport(file, emptyServer(), { drafts: same, storeOps: new Map(), stores: new Set(), payments: new Map() });
    expect(preview.items.find((i) => i.id === O3)!.verdict).toBe("already_on_device");
    const other = waitingDraft(O3, null);
    other.state.notes = "changed on the phone";
    const conflict = previewImport(file, emptyServer(), { drafts: new Map([[O3, other]]), storeOps: new Map(), stores: new Set(), payments: new Map() });
    expect(conflict.items.find((i) => i.id === O3)!.verdict).toBe("conflict");
  });

  it("says nothing would change when everything is already there", () => {
    const server: ServerSnapshot = { orders: new Map([[O1, { version: 3, status: "confirmed" }], [O2, { version: 2, status: "draft" }], [O3, { version: 1, status: "draft" }]]), stores: new Set([S1, S2]) };
    const preview = previewImport(sample(), server, emptyDevice());
    expect(preview.canApply).toBe(false);
    expect(preview.counts.new).toBe(0);
  });
});

describe("applying an import", () => {
  async function openDb(): Promise<BusinessDatabase> {
    const r = await new MemoryDeviceStorage().openBusiness(BIZ);
    if (!r.ok) throw new Error("open failed");
    return r.db;
  }

  it("puts the drafts and stores on this phone as waiting items, with typed lines exactly as typed", async () => {
    const db = await openDb();
    const preview = previewImport(sample(), emptyServer(), emptyDevice());
    const result = await applyImport(preview.plan, db, () => "10:00");
    expect(result).toMatchObject({ ordersAdded: 2, ordersSkipped: 0, storesAdded: 2, storesSkipped: 0, failed: [] });
    const draft = (await db.get("drafts", O3))!;
    expect(draft).toMatchObject({ syncState: "on_device", neverSent: true, baseVersion: null });
    expect(draft.state.lines[0]).toEqual({ id: L(2), product_id: null, name: "Typed med", quantity: 3, unit: "box" });
    expect(draft.state.lines[1]).toEqual({ id: L(3), product_id: M1, name: null, quantity: 2, unit: "strip" });
    expect(draft.lineInfo[L(3)]).toMatchObject({ name: "Panadol", strength: "500 mg", selling_price: null, price_basis: "none" });
    expect((await db.get("storeOps", S2))?.payload.name).toBe("Made offline");
    expect((await db.get("stores", S2))?.pending).toBe(true);
  });

  it("creates nothing a second time when the same file is imported again", async () => {
    const db = await openDb();
    const file = sample();
    await applyImport(previewImport(file, emptyServer(), emptyDevice()).plan, db, () => "10:00");
    const journal = new Journal(db);
    const device: DeviceSnapshot = {
      drafts: new Map((await db.getAll("drafts")).map((d) => [d.orderId, d])),
      storeOps: new Map((await db.getAll("storeOps")).map((o) => [o.storeId, o])),
      stores: new Set((await db.getAll("stores")).map((s) => s.id)),
      payments: new Map(),
    };
    const again = previewImport(file, emptyServer(), device);
    expect(again.canApply).toBe(false);
    expect(again.plan.orders).toEqual([]);
    // even if the plan were applied anyway, nothing is created twice
    const forced = await applyImport(previewImport(file, emptyServer(), emptyDevice()).plan, db, () => "10:00");
    expect(forced).toMatchObject({ ordersAdded: 0, ordersSkipped: 2, storesAdded: 0, storesSkipped: 2 });
    expect((await journal.listUnsynced()).length).toBe(2);
  });

  it("reports a storage failure instead of pretending the import worked", async () => {
    const storage = new MemoryDeviceStorage();
    const r = await storage.openBusiness(BIZ);
    if (!r.ok) throw new Error("open failed");
    storage.failWrites = true;
    const result = await applyImport(previewImport(sample(), emptyServer(), emptyDevice()).plan, r.db, () => "10:00");
    expect(result.ordersAdded).toBe(0);
    expect(result.storesAdded).toBe(0);
    expect(result.failed.length).toBe(4);
  });
});
