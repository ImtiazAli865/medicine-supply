import { describe, expect, it } from "vitest";
import { BACKUP_VERSION, buildBackup, findForbiddenKeys, parseBackup, serializeBackup, waitingPaymentFromOp, type BackupFile } from "@/lib/backup/file";
import type { PaymentOpRecord } from "@/lib/device/schema";

// The backup file of version 2 (Module 011): it carries waiting payments and nothing else about money.

const BIZ = "123e4567-e89b-42d3-a456-426614174000";
const OTHER = "123e4567-e89b-42d3-a456-426614174001";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

function op(paymentId: string, extra: Partial<PaymentOpRecord> = {}): PaymentOpRecord {
  return {
    paymentId,
    rev: 3,
    seq: 1,
    storeId: S1,
    amount: "5000.00",
    date: "2026-11-24",
    reference: "R-1",
    state: "waiting",
    reason: null,
    conflict: null,
    attempted: true,
    tries: 2,
    nextTryTick: 7,
    recordedOn: "10:00",
    ...extra,
  };
}

function build(payments = [waitingPaymentFromOp(op(P1)), waitingPaymentFromOp(op(P2, { amount: "2500.50", reference: null }))]): BackupFile {
  return buildBackup({ businessId: BIZ, exportedAt: "2026-11-24T10:00:00.000Z", source: "device-only", stores: [], orders: [], waitingOrders: [], waitingStores: [], waitingPayments: payments });
}

function reparse(file: unknown) {
  return parseBackup(JSON.stringify(file), BIZ);
}

describe("building a version 2 backup", () => {
  it("writes version 2, the count and exactly the seven fields of each waiting payment", () => {
    const file = build();
    expect(BACKUP_VERSION).toBe(2);
    expect(file.version).toBe(2);
    expect(file.counts.waitingPayments).toBe(2);
    expect(file.waiting.payments).toHaveLength(2);
    for (const p of file.waiting.payments) expect(Object.keys(p).sort()).toEqual(["amount", "date", "paymentId", "reason", "reference", "storeId", "syncState"]);
    expect(file.waiting.payments[0]).toEqual({ paymentId: P1, storeId: S1, amount: "5000.00", date: "2026-11-24", reference: "R-1", syncState: "waiting", reason: null });
  });

  it("maps the state of a payment on the phone and keeps nothing that is only for sending", () => {
    expect(waitingPaymentFromOp(op(P1, { state: "syncing" })).syncState).toBe("waiting");
    expect(waitingPaymentFromOp(op(P1, { state: "on_device", attempted: false })).syncState).toBe("on_device");
    const conflict = waitingPaymentFromOp(op(P1, { state: "conflict", conflict: "not_found", reason: "This store is not on the server." }));
    expect(conflict).toMatchObject({ syncState: "conflict", reason: "This store is not on the server." });
    const text = JSON.stringify(conflict);
    for (const word of ["attempted", "tries", "nextTryTick", "rev", "seq", "recordedOn", "conflict\":"]) expect(text).not.toContain(word);
  });

  it("round trips: what is written is read back exactly", () => {
    const file = build();
    const read = parseBackup(serializeBackup(file), BIZ);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.file).toEqual(file);
  });

  it("an empty list of payments is a valid file", () => {
    const file = build([]);
    expect(file.counts.waitingPayments).toBe(0);
    expect(reparse(file).ok).toBe(true);
  });
});

describe("reading a backup file", () => {
  it("still reads a version 1 file (no payments) and shows no payments", () => {
    const v1 = JSON.parse(serializeBackup(build([])));
    v1.version = 1;
    delete v1.waiting.payments;
    delete v1.counts.waitingPayments;
    const read = reparse(v1);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.file.waiting.payments).toEqual([]);
      expect(read.file.counts.waitingPayments).toBe(0);
    }
  });

  it("refuses a version 1 file that claims payments, and a version 3 file, with the existing messages", () => {
    const v1 = JSON.parse(serializeBackup(build()));
    v1.version = 1;
    const refused = reparse(v1);
    expect(refused.ok).toBe(false);
    const v3 = JSON.parse(serializeBackup(build()));
    v3.version = 3;
    const unknown = reparse(v3);
    expect(unknown).toMatchObject({ ok: false, reason: "unknown_version", message: "This backup was made by a different version of the app and cannot be read. Nothing was imported." });
  });

  it("refuses a file of another business with the existing message", () => {
    const read = parseBackup(serializeBackup(build()), OTHER);
    expect(read).toMatchObject({ ok: false, reason: "other_business", message: "This backup belongs to another business and cannot be imported here. Nothing was imported." });
  });

  it("refuses a payment with an extra key, a bad amount, a bad id, a bad date, a long reference or a bad state", () => {
    const bad: Array<[string, (p: Record<string, unknown>) => void]> = [
      ["an extra key", (p) => (p.note = "x")],
      ["amount without decimals", (p) => (p.amount = "5000")],
      ["amount with three decimals", (p) => (p.amount = "5000.001")],
      ["amount text", (p) => (p.amount = "abc")],
      ["amount zero", (p) => (p.amount = "0.00")],
      ["amount negative", (p) => (p.amount = "-5.00")],
      ["amount too large", (p) => (p.amount = "99999999999.00")],
      ["payment id", (p) => (p.paymentId = "nope")],
      ["store id", (p) => (p.storeId = "nope")],
      ["date", (p) => (p.date = "24/11/2026")],
      ["impossible date", (p) => (p.date = "2026-13-45")],
      ["reference too long", (p) => (p.reference = "x".repeat(101))],
      ["state", (p) => (p.syncState = "synced")],
    ];
    for (const [name, change] of bad) {
      const file = JSON.parse(serializeBackup(build()));
      change(file.waiting.payments[0]);
      const read = reparse(file);
      expect(read.ok, name).toBe(false);
    }
  });

  it("refuses more than 5,000 payments and a count that does not match", () => {
    const many = Array.from({ length: 5001 }, (_, i) => waitingPaymentFromOp(op(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)));
    expect(reparse(build(many)).ok).toBe(false);
    const file = JSON.parse(serializeBackup(build()));
    file.counts.waitingPayments = 1;
    expect(reparse(file)).toMatchObject({ ok: false, message: "The counts in this backup do not match its contents, so it may be damaged. Nothing was imported." });
  });
});

describe("what a backup never contains", () => {
  it("has no forbidden key in a clean file with payments", () => {
    expect(findForbiddenKeys(JSON.parse(serializeBackup(build())))).toEqual([]);
  });

  it("finds a balance, invoice, ledger, cost, price or margin key anywhere, also inside a payment", () => {
    for (const key of ["balance", "invoice", "invoice_id", "ledger", "ledger_entry", "cost", "unit_cost", "profit", "margin", "mrp", "selling_price", "purchase_price"]) {
      const file = JSON.parse(serializeBackup(build()));
      file.waiting.payments[0][key] = "1";
      expect(findForbiddenKeys(file), key).toEqual([`$.waiting.payments[0].${key}`]);
      expect(reparse(file).ok, key).toBe(false);
    }
  });

  it("finds the key payments at any other place", () => {
    const file = JSON.parse(serializeBackup(build()));
    file.stores = [{ payments: [] }];
    expect(findForbiddenKeys(file)).toEqual(["$.stores[0].payments"]);
    const moved = JSON.parse(serializeBackup(build()));
    moved.payments = moved.waiting.payments;
    expect(findForbiddenKeys(moved)).toContain("$.payments");
  });

  it("writes a text with no balance, invoice, ledger, price, cost, margin or profit as a key", () => {
    const text = serializeBackup(build());
    for (const word of ["balance", "invoice", "ledger", "price", "mrp", "cost", "margin", "profit", "token", "password", "secret", "cookie"]) {
      expect(text, word).not.toMatch(new RegExp(`"[^"]*${word}[^"]*"\\s*:`, "i"));
    }
  });
});
