// The backup file (Module 009, contracts/backup-file.schema.json): orders and their lines, stores, typed lines and the items
// still waiting on the phone, of ONE business. It never contains a price of any kind, an invoice, a balance, a ledger entry,
// a purchase, a password, a key, a token or the cookie. Since version 2 it also holds the cash payments waiting on the phone
// (only what was typed: the store, amount, date, reference and the payment's key). Pure code: building, writing, reading and checking a file.

import { z } from "zod";
import type { LineInfo } from "@/lib/orders/editor-state";
import type { DraftRecord, PaymentOpRecord, StoreOpRecord } from "@/lib/device/schema";
import { isValidMoney, parseMoneyToPaisa } from "@/lib/money";

export const BACKUP_FORMAT = "medsupply-backup";
/** Version 2 (Module 011) adds the cash payments waiting on the phone. Version 1 files are still read (they have no payments). */
// Version 3 (Module 012) lets a waiting order line carry the price the supplier typed (and the "remember" tick).
export const BACKUP_VERSION = 3;
const READABLE_VERSIONS: readonly number[] = [1, 2, 3];
/** The most waiting payments one file may hold. */
export const MAX_BACKUP_PAYMENTS = 5000;

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uuid = z.string().regex(UUID, "not a valid id");
const text = z.string().nullable().optional();
const quantity = z.number().int().min(1).max(100000);

const storeSchema = z
  .object({
    id: uuid,
    name: z.string().min(1).max(200),
    contact_person: z.string().max(200).nullable().optional(),
    phone: z.string().max(50).nullable().optional(),
    address: z.string().max(500).nullable().optional(),
    is_active: z.boolean(),
  })
  .strict();

const lineSchema = z
  .object({
    id: uuid,
    position: z.number().int().min(0),
    product_id: uuid.nullable(),
    name: z.string().min(1).max(200),
    strength: text,
    dosage_form: text,
    pack_size: text,
    manufacturer: text,
    quantity,
    unit: z.string().min(1).max(50),
    delivered_quantity: z.number().int().min(0).nullable().optional(),
  })
  .strict();

const orderSchema = z
  .object({
    id: uuid,
    order_number: z.number().int().min(1),
    status: z.enum(["draft", "confirmed", "cancelled", "fulfilled"]),
    source: z.enum(["manual", "voice"]).optional(),
    notes: z.string().max(1000).nullable().optional(),
    version: z.number().int().min(1),
    store_id: uuid,
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
    confirmed_at: z.string().nullable().optional(),
    cancelled_at: z.string().nullable().optional(),
    cancel_reason: z.string().max(500).nullable().optional(),
    lines: z.array(lineSchema).max(200),
  })
  .strict();

const waitingLineSchema = z
  .object({
    id: uuid,
    product_id: uuid.nullable(),
    name: z.string().max(200).nullable(),
    display_name: z.string().max(200).optional(),
    strength: text,
    dosage_form: text,
    pack_size: text,
    manufacturer: text,
    quantity,
    unit: z.string().min(1).max(50),
    price: z.string().regex(/^\d{1,10}\.\d{2}$/, "not a money amount").nullable().optional(),
    remember: z.boolean().optional(),
    rateVersion: z.number().int().min(1).nullable().optional(),
  })
  .strict();

const waitingOrderSchema = z
  .object({
    orderId: uuid,
    storeId: uuid,
    baseVersion: z.number().int().min(1).nullable(),
    neverSent: z.boolean(),
    syncState: z.enum(["on_device", "waiting", "failed", "conflict", "blocked"]),
    reason: z.string().nullable().optional(),
    notes: z.string().max(1000),
    lines: z.array(waitingLineSchema).max(200),
  })
  .strict();

const waitingStoreSchema = z
  .object({
    storeId: uuid,
    name: z.string().min(1).max(200),
    contact_person: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    syncState: z.enum(["on_device", "waiting", "failed", "similar"]),
  })
  .strict();

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// A waiting payment holds only what the person typed. It never holds a balance, an invoice, a ledger entry or a price.
const waitingPaymentSchema = z
  .object({
    paymentId: uuid,
    storeId: uuid,
    amount: z
      .string()
      .regex(/^\d{1,10}\.\d{2}$/, "not a money amount")
      .refine((a) => isValidMoney(a) && (parseMoneyToPaisa(a) ?? 0) > 0, "not above zero"),
    date: z
      .string()
      .regex(DAY)
      .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "not a date"),
    reference: z.string().max(100).nullable().optional(),
    syncState: z.enum(["on_device", "waiting", "conflict"]),
    reason: z.string().nullable().optional(),
  })
  .strict();

export const backupSchema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    exportedAt: z.string().min(1),
    businessId: uuid,
    source: z.enum(["server+device", "device-only"]),
    counts: z
      .object({
        stores: z.number().int().min(0),
        orders: z.number().int().min(0),
        lines: z.number().int().min(0),
        waitingOrders: z.number().int().min(0),
        waitingStores: z.number().int().min(0),
        waitingPayments: z.number().int().min(0),
      })
      .strict(),
    stores: z.array(storeSchema),
    orders: z.array(orderSchema),
    waiting: z.object({ orders: z.array(waitingOrderSchema), stores: z.array(waitingStoreSchema), payments: z.array(waitingPaymentSchema).max(MAX_BACKUP_PAYMENTS) }).strict(),
  })
  .strict();

export type BackupFile = z.infer<typeof backupSchema>;
export type BackupStore = z.infer<typeof storeSchema>;
export type BackupOrder = z.infer<typeof orderSchema>;
export type BackupWaitingOrder = z.infer<typeof waitingOrderSchema>;
export type BackupWaitingStore = z.infer<typeof waitingStoreSchema>;
export type BackupWaitingPayment = z.infer<typeof waitingPaymentSchema>;

// ---------------------------------------------------------------- building

/** Keys that must never appear anywhere in a backup, at any depth. */
const FORBIDDEN_KEY = /price|mrp|cost|margin|profit|balance|invoice|payment|ledger|purchase|token|password|secret|cookie|device_?id|api_?key|authorization/i;

/**
 * The one exception (Module 011): waiting payments are device data, so the key `payments` is allowed at `$.waiting` and the key
 * `paymentId` inside an entry of `$.waiting.payments`, and the count `waitingPayments` at `$.counts`. Nothing else is allowed: a `payments` key anywhere else, and every other
 * forbidden key (balance, invoice, ledger, a price, a cost...) anywhere, including inside a payment entry, is still found.
 */
function isAllowedPaymentKey(path: string, key: string): boolean {
  // Module 012: the one other exception, the price typed on a line of an order still waiting on the phone.
  if (key === "price") return /^\$\.waiting\.orders\[\d+\]\.lines\[\d+\]$/.test(path);
  if (key === "payments") return path === "$.waiting";
  if (key === "waitingPayments") return path === "$.counts";
  if (key === "paymentId") return /^\$\.waiting\.payments\[\d+\]$/.test(path);
  return false;
}

export function findForbiddenKeys(value: unknown, path = "$"): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((v, i) => findForbiddenKeys(v, `${path}[${i}]`));
  const found: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key) && !isAllowedPaymentKey(path, key)) found.push(`${path}.${key}`);
    found.push(...findForbiddenKeys(child, `${path}.${key}`));
  }
  return found;
}

function infoOf(info: LineInfo | undefined) {
  return {
    display_name: info?.name,
    strength: info?.strength ?? null,
    dosage_form: info?.dosage_form ?? null,
    pack_size: info?.pack_size ?? null,
    manufacturer: info?.manufacturer ?? null,
  };
}

export function waitingOrderFromDraft(draft: DraftRecord): BackupWaitingOrder {
  const syncState = draft.syncState === "syncing" ? "waiting" : draft.syncState;
  return {
    orderId: draft.orderId,
    storeId: draft.state.storeId,
    baseVersion: draft.baseVersion,
    neverSent: draft.neverSent,
    syncState: syncState === "synced" ? "on_device" : syncState,
    reason: draft.reason,
    notes: draft.state.notes,
    lines: draft.state.lines.map((l) => ({
      id: l.id,
      product_id: l.product_id,
      name: l.product_id === null ? l.name : null,
      ...infoOf(draft.lineInfo[l.id]),
      quantity: l.quantity,
      unit: l.unit,
      // Only what the supplier typed for this order; never a catalog price or a store rate.
      ...(l.price !== undefined ? { price: l.price } : {}),
      ...(l.remember ? { remember: true, rateVersion: l.rate_version ?? null } : {}),
    })),
  };
}

export function waitingStoreFromOp(op: StoreOpRecord): BackupWaitingStore {
  return {
    storeId: op.storeId,
    name: op.payload.name,
    contact_person: op.payload.contact_person,
    phone: op.payload.phone,
    syncState: op.state === "syncing" ? "waiting" : op.state === "synced" ? "on_device" : op.state,
  };
}

/** What a backup keeps of a payment waiting on the phone: the typed values and its key, never how it is being sent. */
export function waitingPaymentFromOp(op: PaymentOpRecord): BackupWaitingPayment {
  return {
    paymentId: op.paymentId,
    storeId: op.storeId,
    amount: op.amount,
    date: op.date,
    reference: op.reference,
    syncState: op.state === "syncing" ? "waiting" : op.state,
    reason: op.reason,
  };
}

export interface BuildInput {
  businessId: string;
  exportedAt: string;
  source: BackupFile["source"];
  stores: BackupStore[];
  orders: BackupOrder[];
  waitingOrders: BackupWaitingOrder[];
  waitingStores: BackupWaitingStore[];
  waitingPayments?: BackupWaitingPayment[];
}

export function buildBackup(input: BuildInput): BackupFile {
  const waitingPayments = input.waitingPayments ?? [];
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: input.exportedAt,
    businessId: input.businessId,
    source: input.source,
    counts: {
      stores: input.stores.length,
      orders: input.orders.length,
      lines: input.orders.reduce((n, o) => n + o.lines.length, 0),
      waitingOrders: input.waitingOrders.length,
      waitingStores: input.waitingStores.length,
      waitingPayments: waitingPayments.length,
    },
    stores: input.stores,
    orders: input.orders,
    waiting: { orders: input.waitingOrders, stores: input.waitingStores, payments: waitingPayments },
  };
}

export function serializeBackup(file: BackupFile): string {
  return `${JSON.stringify(file, null, 1)}\n`;
}

/** A file name that carries the date, for example `medsupply-backup-2026-11-21.json`. */
export function backupFileName(exportedAt: string): string {
  return `medsupply-backup-${exportedAt.slice(0, 10)}.json`;
}

// ---------------------------------------------------------------- reading

export type ParseResult =
  | { ok: true; file: BackupFile }
  | { ok: false; reason: "damaged" | "unknown_version" | "other_business"; message: string };

export function parseBackup(textContent: string, expectedBusinessId: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(textContent);
  } catch {
    return { ok: false, reason: "damaged", message: "This file is damaged or is not a backup file. Nothing was imported." };
  }
  if (raw === null || typeof raw !== "object" || (raw as { format?: unknown }).format !== BACKUP_FORMAT) {
    return { ok: false, reason: "damaged", message: "This is not a backup file of this app. Nothing was imported." };
  }
  const version = (raw as { version?: unknown }).version;
  if (typeof version !== "number" || !READABLE_VERSIONS.includes(version)) {
    return { ok: false, reason: "unknown_version", message: "This backup was made by a different version of the app and cannot be read. Nothing was imported." };
  }
  const forbidden = findForbiddenKeys(raw);
  if (forbidden.length > 0) {
    return { ok: false, reason: "damaged", message: "This file holds data a backup never contains, so it was refused. Nothing was imported." };
  }
  if (version === 1) {
    // A version 1 file has no payments: it is read as an empty list. A version 1 file that names payments is not a file this app wrote.
    const v1 = raw as { waiting?: { payments?: unknown }; counts?: { waitingPayments?: unknown } };
    if (v1.waiting?.payments !== undefined || v1.counts?.waitingPayments !== undefined) {
      return { ok: false, reason: "damaged", message: "This backup file is damaged or incomplete. Nothing was imported." };
    }
    if (v1.waiting && typeof v1.waiting === "object") v1.waiting.payments = [];
    if (v1.counts && typeof v1.counts === "object") v1.counts.waitingPayments = 0;
  }
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "damaged", message: "This backup file is damaged or incomplete. Nothing was imported." };
  }
  const file = parsed.data;
  if (file.businessId.toLowerCase() !== expectedBusinessId.toLowerCase()) {
    return { ok: false, reason: "other_business", message: "This backup belongs to another business and cannot be imported here. Nothing was imported." };
  }
  const lines = file.orders.reduce((n, o) => n + o.lines.length, 0);
  const c = file.counts;
  if (
    c.stores !== file.stores.length ||
    c.orders !== file.orders.length ||
    c.lines !== lines ||
    c.waitingOrders !== file.waiting.orders.length ||
    c.waitingStores !== file.waiting.stores.length ||
    c.waitingPayments !== file.waiting.payments.length
  ) {
    return { ok: false, reason: "damaged", message: "The counts in this backup do not match its contents, so it may be damaged. Nothing was imported." };
  }
  return { ok: true, file };
}
