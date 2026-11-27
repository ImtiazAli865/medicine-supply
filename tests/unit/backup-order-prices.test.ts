import { describe, expect, it } from "vitest";
import { applyImport } from "@/lib/backup/apply";
import { buildBackup, findForbiddenKeys, parseBackup, serializeBackup, waitingOrderFromDraft } from "@/lib/backup/file";
import { previewImport } from "@/lib/backup/preview";
import { MemoryDeviceStorage } from "../helpers/memory-storage";
import type { DraftRecord } from "@/lib/device/schema";

// Module 012 (backup file version 3): the only price a backup may carry is the one typed on a line of an order still
// waiting on the phone. A price anywhere else, and every other money key, is still refused.

const draft = {
  orderId: "11111111-1111-4111-8111-111111111111",
  rev: 1,
  seq: 1,
  state: {
    storeId: "22222222-2222-4222-8222-222222222222",
    notes: "",
    lines: [
      { id: "33333333-3333-4333-8333-333333333333", product_id: "44444444-4444-4444-8444-444444444444", name: null, quantity: 2, unit: "strip", price: "220.00", remember: true, rate_version: 3 },
      { id: "55555555-5555-4555-8555-555555555555", product_id: "44444444-4444-4444-8444-444444444444", name: null, quantity: 1, unit: "strip" },
    ],
  },
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
  updatedOnDevice: "2026-11-26T00:00:00Z",
} as unknown as DraftRecord;

describe("a typed price on a waiting order", () => {
  it("is written with the remember tick, and a line without one carries no price at all", () => {
    const written = waitingOrderFromDraft(draft);
    expect(written.lines[0]).toMatchObject({ price: "220.00", remember: true, rateVersion: 3 });
    expect(Object.keys(written.lines[1]!)).not.toContain("price");
  });

  it("is the only place a price key is allowed", () => {
    expect(findForbiddenKeys({ waiting: { orders: [{ lines: [{ price: "1.00" }] }] } })).toEqual([]);
    for (const bad of [
      { orders: [{ lines: [{ price: "1.00" }] }] },
      { waiting: { orders: [{ price: "1.00" }] } },
      { waiting: { stores: [{ price: "1.00" }] } },
      { waiting: { orders: [{ lines: [{ selling_price: "1.00" }] }] } },
      { waiting: { orders: [{ lines: [{ purchase_price: "1.00" }] }] } },
      { waiting: { orders: [{ lines: [{ balance: "1.00" }] }] } },
      { rates: [{ price: "1.00" }] },
    ]) {
      expect(findForbiddenKeys(bad).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });
});

describe("restoring a file with a typed price", () => {
  const BIZ = "123e4567-e89b-42d3-a456-426614174000";

  it("puts the order back with the typed price and the remember tick, exactly as it was", async () => {
    const file = buildBackup({
      businessId: BIZ,
      exportedAt: "2026-11-27T10:00:00.000Z",
      source: "server+device",
      stores: [],
      orders: [],
      waitingOrders: [waitingOrderFromDraft(draft)],
      waitingStores: [],
    });
    const read = parseBackup(serializeBackup(file), BIZ);
    if (!read.ok) throw new Error(read.message);
    const storage = new MemoryDeviceStorage();
    const opened = await storage.openBusiness(BIZ);
    if (!opened.ok) throw new Error("open failed");
    const preview = previewImport(read.file, { orders: new Map(), stores: new Set([draft.state.storeId]) }, { drafts: new Map(), storeOps: new Map(), stores: new Set(), payments: new Map() });
    await applyImport(preview.plan, opened.db, () => "10:00");
    const restored = (await opened.db.getAll("drafts"))[0]!;
    expect(restored.state.lines[0]).toMatchObject({ price: "220.00", remember: true, rate_version: 3 });
    expect("price" in restored.state.lines[1]!).toBe(false);
  });

  it("still reads a version 2 file, whose waiting orders carry no price", () => {
    const plain = { ...draft, state: { ...draft.state, lines: [draft.state.lines[1]!] } } as DraftRecord;
    const old = JSON.parse(
      serializeBackup(
        buildBackup({ businessId: BIZ, exportedAt: "2026-11-24T10:00:00.000Z", source: "server+device", stores: [], orders: [], waitingOrders: [waitingOrderFromDraft(plain)], waitingStores: [] }),
      ),
    );
    old.version = 2;
    const read = parseBackup(JSON.stringify(old), BIZ);
    if (!read.ok) throw new Error(read.message);
    expect(read.file.waiting.orders).toHaveLength(1);
    expect(Object.keys(read.file.waiting.orders[0]!.lines[0]!)).not.toContain("price");
  });
});
