import { describe, expect, it } from "vitest";
import { MemoryDeviceStorage } from "../helpers/memory-storage";
import { applyImport } from "@/lib/backup/apply";
import { buildBackupFile, loadDeviceSnapshot } from "@/lib/backup/client";
import { buildBackup, waitingPaymentFromOp, type BackupFile } from "@/lib/backup/file";
import { previewImport, type DeviceSnapshot, type ServerSnapshot } from "@/lib/backup/preview";
import type { BusinessDatabase, PaymentOpRecord } from "@/lib/device/schema";
import { newPaymentOp } from "@/lib/device/payments";

// Restoring waiting payments from a backup file (Module 011, US3): never applied twice, never over a payment already on the phone,
// shown first in the preview with exact totals, and a restore of the same file twice leaves the same set.

const BIZ = "123e4567-e89b-42d3-a456-426614174000";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GONE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";

async function openDb(): Promise<BusinessDatabase> {
  const r = await new MemoryDeviceStorage().openBusiness(BIZ);
  if (!r.ok) throw new Error("open failed");
  return r.db;
}

function op(paymentId: string, storeId: string, amount: string, extra: Partial<PaymentOpRecord> = {}): PaymentOpRecord {
  return { ...newPaymentOp({ paymentId, storeId, input: { amount, date: "2026-11-24", reference: null }, seq: 1, recordedOn: "10:00" }), ...extra };
}

function fileWith(payments: PaymentOpRecord[], stores = [{ id: S1, name: "Alpha", contact_person: null, phone: null, address: null, is_active: true }, { id: S2, name: "Beta", contact_person: null, phone: null, address: null, is_active: true }]): BackupFile {
  return buildBackup({ businessId: BIZ, exportedAt: "2026-11-24T10:00:00.000Z", source: "server+device", stores, orders: [], waitingOrders: [], waitingStores: [], waitingPayments: payments.map(waitingPaymentFromOp) });
}

const server: ServerSnapshot = { orders: new Map(), stores: new Set([S1, S2]) };
const emptyDevice = (): DeviceSnapshot => ({ drafts: new Map(), storeOps: new Map(), stores: new Set(), payments: new Map() });

describe("the preview of a restore with payments", () => {
  it("lists the payments first, each as new on this phone, with exact counts and total", () => {
    const file = fileWith([op(P1, S1, "0.10"), op(P2, S2, "0.20"), op(P3, S1, "5000.00")]);
    const preview = previewImport(file, server, emptyDevice());
    expect(preview.items.slice(0, 3).map((i) => [i.kind, i.id, i.verdict])).toEqual([
      ["payment", P1, "new"],
      ["payment", P2, "new"],
      ["payment", P3, "new"],
    ]);
    expect(preview.items[0]!.reason).toBe("This payment will be kept on this phone and sent. The server records a payment once, also when it already has this one.");
    expect(preview.plan.payments.map((p) => p.paymentId)).toEqual([P1, P2, P3]);
    expect(preview.payments).toEqual({ count: 3, paisa: 500_030 });
    expect(preview.canApply).toBe(true);
  });

  it("marks a payment already waiting on this phone and does not plan it again", () => {
    const device = emptyDevice();
    device.payments.set(P1, op(P1, S1, "100.00", { state: "waiting", attempted: true }));
    const preview = previewImport(fileWith([op(P1, S1, "100.00"), op(P2, S1, "200.00")]), server, device);
    expect(preview.items.filter((i) => i.kind === "payment").map((i) => [i.id, i.verdict])).toEqual([
      [P1, "already_on_device"],
      [P2, "new"],
    ]);
    expect(preview.items[0]!.reason).toBe("This phone already has this payment, waiting to be sent. It is kept as it is.");
    expect(preview.plan.payments.map((p) => p.paymentId)).toEqual([P2]);
    expect(preview.payments).toEqual({ count: 1, paisa: 20_000 });
  });

  it("queues a payment whose store is nowhere and says it will need a decision when sent", () => {
    const preview = previewImport(fileWith([op(P1, GONE, "100.00")], []), server, emptyDevice());
    const item = preview.items.find((i) => i.kind === "payment")!;
    expect(item.verdict).toBe("new");
    expect(item.reason).toContain("store is not on this phone or the server");
    expect(preview.plan.payments).toHaveLength(1);
  });

  it("a payment for a store the file lists as waiting counts as known", () => {
    const file = buildBackup({
      businessId: BIZ,
      exportedAt: "2026-11-24T10:00:00.000Z",
      source: "device-only",
      stores: [],
      orders: [],
      waitingOrders: [],
      waitingStores: [{ storeId: GONE, name: "Made Offline", contact_person: null, phone: null, syncState: "on_device" }],
      waitingPayments: [waitingPaymentFromOp(op(P1, GONE, "100.00"))],
    });
    const preview = previewImport(file, server, emptyDevice());
    expect(preview.items.find((i) => i.kind === "payment")!.reason).not.toContain("not on this phone or the server");
  });

  it("has nothing to apply for an old file with no payments", () => {
    const preview = previewImport(fileWith([]), server, emptyDevice());
    expect(preview.plan.payments).toEqual([]);
    expect(preview.payments).toEqual({ count: 0, paisa: 0 });
    expect(preview.items.filter((i) => i.kind === "payment")).toEqual([]);
  });
});

describe("applying a restore with payments", () => {
  it("queues each new payment as waiting on this phone, not attempted, in the order of the file, in one step", async () => {
    const db = await openDb();
    const file = fileWith([op(P1, S1, "100.00"), op(P2, S2, "200.00")]);
    const preview = previewImport(file, server, await loadDeviceSnapshot(db));
    const result = await applyImport(preview.plan, db, () => "11:00");
    expect(result).toMatchObject({ paymentsAdded: 2, paymentsSkipped: 0, failed: [] });
    const stored = (await db.getAll("paymentOps")).sort((a, b) => a.seq - b.seq);
    expect(stored.map((p) => [p.paymentId, p.storeId, p.amount, p.state, p.attempted, p.seq, p.recordedOn])).toEqual([
      [P1, S1, "100.00", "on_device", false, 1, "11:00"],
      [P2, S2, "200.00", "on_device", false, 2, "11:00"],
    ]);
  });

  it("keeps a payment already waiting exactly as it is and never doubles it", async () => {
    const db = await openDb();
    const waiting = op(P1, S1, "100.00", { state: "waiting", attempted: true, tries: 3, rev: 9, reason: "Server error" });
    await db.put("paymentOps", waiting);
    const file = fileWith([op(P1, S1, "100.00"), op(P2, S1, "50.00")]);
    const preview = previewImport(file, server, await loadDeviceSnapshot(db));
    const result = await applyImport(preview.plan, db, () => "11:00");
    expect(result.paymentsAdded).toBe(1);
    expect(await db.get("paymentOps", P1)).toEqual(waiting);
    expect((await db.getAll("paymentOps")).map((p) => p.paymentId).sort()).toEqual([P1, P2]);
  });

  it("never overwrites a payment that appeared on the phone between the preview and the confirmation", async () => {
    const db = await openDb();
    const file = fileWith([op(P1, S1, "100.00")]);
    const preview = previewImport(file, server, await loadDeviceSnapshot(db));
    const newer = op(P1, S1, "100.00", { state: "waiting", attempted: true, rev: 5 });
    await db.put("paymentOps", newer);
    const result = await applyImport(preview.plan, db, () => "11:00");
    expect(result).toMatchObject({ paymentsAdded: 0, paymentsSkipped: 1 });
    expect(await db.get("paymentOps", P1)).toEqual(newer);
  });

  it("restoring the same file twice leaves exactly the same set of payments", async () => {
    const db = await openDb();
    const file = fileWith([op(P1, S1, "100.00"), op(P2, S2, "200.00"), op(P3, GONE, "300.00")]);
    for (let i = 0; i < 2; i += 1) {
      const preview = previewImport(file, server, await loadDeviceSnapshot(db));
      await applyImport(preview.plan, db, () => "11:00");
    }
    const stored = await db.getAll("paymentOps");
    expect(stored.map((p) => p.paymentId).sort()).toEqual([P1, P2, P3]);
    expect(stored.find((p) => p.paymentId === P3)?.storeId).toBe(GONE); // queued; it becomes a conflict when sent
  });

  it("puts new payments after the ones already on the phone", async () => {
    const db = await openDb();
    await db.put("paymentOps", op("p-old", S1, "10.00", { seq: 4 }));
    const preview = previewImport(fileWith([op(P1, S1, "100.00")]), server, await loadDeviceSnapshot(db));
    await applyImport(preview.plan, db, () => "11:00");
    expect((await db.get("paymentOps", P1))?.seq).toBe(5);
  });

  it("keeps nothing when the phone cannot keep them: all or none", async () => {
    const storage = new MemoryDeviceStorage();
    const r = await storage.openBusiness(BIZ);
    if (!r.ok) throw new Error("open failed");
    const db = r.db;
    const preview = previewImport(fileWith([op(P1, S1, "100.00"), op(P2, S2, "200.00")]), server, await loadDeviceSnapshot(db));
    storage.failAfterWrites = 2;
    const result = await applyImport(preview.plan, db, () => "11:00");
    expect(result.paymentsAdded).toBe(0);
    expect(result.failed.length).toBeGreaterThan(0);
    expect(await db.getAll("paymentOps")).toEqual([]);
  });
});

describe("the backup built from a phone with waiting payments", () => {
  it("carries the payments of the phone, in the order recorded, and no sending details", async () => {
    const db = await openDb();
    await db.put("paymentOps", op(P2, S2, "200.00", { seq: 2, state: "waiting", attempted: true, tries: 4 }));
    await db.put("paymentOps", op(P1, S1, "100.00", { seq: 1 }));
    const file = await buildBackupFile({ db, businessId: BIZ, now: () => "2026-11-24T10:00:00.000Z", fetchPage: null });
    expect(file.waiting.payments.map((p) => [p.paymentId, p.syncState])).toEqual([
      [P1, "on_device"],
      [P2, "waiting"],
    ]);
    expect(file.counts.waitingPayments).toBe(2);
    expect(JSON.stringify(file)).not.toMatch(/attempted|tries|nextTry/);
  });
});
