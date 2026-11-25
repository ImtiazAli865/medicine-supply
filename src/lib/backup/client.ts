// The backup, seen from the phone (Module 009, US5): building the file from the server's pages plus what waits on this phone,
// reading a file the supplier chose, and comparing it with the server and with this phone for the import preview. The page
// fetch is injected, so this code is tested without a network. Nothing here writes to the server.

import type { BusinessDatabase } from "@/lib/device/schema";
import { Journal } from "@/lib/device/journal";
import type { ExportPage } from "./export-repository";
import {
  buildBackup,
  parseBackup,
  waitingOrderFromDraft,
  waitingPaymentFromOp,
  waitingStoreFromOp,
  type BackupFile,
  type BackupOrder,
  type BackupStore,
  type ParseResult,
} from "./file";
import type { DeviceSnapshot, ServerSnapshot } from "./preview";

export type FetchExportPage = (cursor: string | null) => Promise<ExportPage>;

/** Every page of the server export (stores come with the first page). Throws when a page cannot be fetched. */
export async function fetchAllExportPages(fetchPage: FetchExportPage): Promise<{ stores: BackupStore[]; orders: BackupOrder[] }> {
  const stores: BackupStore[] = [];
  const orders: BackupOrder[] = [];
  let cursor: string | null = null;
  do {
    const page: ExportPage = await fetchPage(cursor);
    stores.push(...page.stores);
    orders.push(...page.orders);
    cursor = page.next_cursor;
  } while (cursor);
  return { stores, orders };
}

export interface BuildArgs {
  db: BusinessDatabase;
  businessId: string;
  now: () => string;
  /** Null when the phone is offline: the file then holds only what this phone has and says so. */
  fetchPage: FetchExportPage | null;
}

/** The backup file: the server's stores and orders (online) plus every item still waiting on this phone. */
export async function buildBackupFile(args: BuildArgs): Promise<BackupFile> {
  const journal = new Journal(args.db);
  const waitingOrders = (await journal.listUnsynced()).map(waitingOrderFromDraft);
  const ops = (await args.db.getAll("storeOps")).filter((o) => o.state !== "synced");
  const waitingStores = ops.map(waitingStoreFromOp);
  const waitingPayments = (await args.db.getAll("paymentOps")).sort((a, b) => a.seq - b.seq).map(waitingPaymentFromOp);

  let source: BackupFile["source"] = "device-only";
  let stores: BackupStore[] = [];
  let orders: BackupOrder[] = [];
  if (args.fetchPage) {
    try {
      const all = await fetchAllExportPages(args.fetchPage);
      stores = all.stores;
      orders = all.orders;
      source = "server+device";
    } catch {
      // The connection failed while reading: the file is made from what this phone has and says so.
    }
  }
  if (source === "device-only") {
    const pending = new Set(ops.map((o) => o.storeId));
    stores = (await args.db.getAll("stores"))
      .filter((s) => !s.pending && !pending.has(s.id))
      .map((s) => ({ id: s.id, name: s.name, contact_person: s.contact_person, phone: s.phone, address: s.address, is_active: s.is_active }));
  }
  return buildBackup({ businessId: args.businessId, exportedAt: args.now(), source, stores, orders, waitingOrders, waitingStores, waitingPayments });
}

/** Reads the text of a chosen file and checks it. Nothing is changed. */
export function readBackupText(text: string, businessId: string): ParseResult {
  return parseBackup(text, businessId);
}

/** What the server holds, for the import preview. Throws when the server cannot be reached. */
export async function loadServerSnapshot(fetchPage: FetchExportPage): Promise<ServerSnapshot> {
  const all = await fetchAllExportPages(fetchPage);
  return {
    orders: new Map(all.orders.map((o) => [o.id, { version: o.version, status: o.status }])),
    stores: new Set(all.stores.map((s) => s.id)),
  };
}

/** What this phone holds, for the import preview. */
export async function loadDeviceSnapshot(db: BusinessDatabase): Promise<DeviceSnapshot> {
  return {
    drafts: new Map((await db.getAll("drafts")).map((d) => [d.orderId, d])),
    storeOps: new Map((await db.getAll("storeOps")).map((o) => [o.storeId, o])),
    stores: new Set((await db.getAll("stores")).map((s) => s.id)),
    payments: new Map((await db.getAll("paymentOps")).map((p) => [p.paymentId, p])),
  };
}
