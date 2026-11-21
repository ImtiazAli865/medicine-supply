// Answers for a fixed list of GET requests from the device copy (Module 009, plan D7). They return the same JSON shape as
// the routes, so the Module 008 components and hooks work unchanged when the network fails. Used only when the real request
// failed with a network error (or the offline shell is active), only while the signed-in business's own database is open,
// and never for any other path or method (the caller then shows the real error).
//
// Answers say plainly when something is NOT on the phone ("not saved on this phone yet") instead of pretending the store
// has no history.

import { filterMedicines, normalizeRow, parseQuery, type SearchRow } from "@/lib/orders/fast-search";
import type { MedicinePage } from "@/lib/orders/fast-types";
import type { Order, OrderSummary } from "@/lib/orders/types";
import { searchTokens } from "@/lib/normalize";
import type { Store } from "@/lib/stores/types";
import type { BusinessDatabase, DraftRecord, StoredStore } from "./schema";

export interface LocalAnswer {
  status: number;
  body: unknown;
}

const MAX_PAGE = 900;

function ok(body: unknown): LocalAnswer {
  return { status: 200, body };
}

function notFound(message = "Not found."): LocalAnswer {
  return { status: 404, body: { code: "not_found", message } };
}

function notOnPhone(what: string): LocalAnswer {
  return {
    status: 503,
    body: {
      code: "server_error",
      message: `${what} is not saved on this phone yet. It is saved when you open the store while online. You can still add medicines by search or type them.`,
    },
  };
}

function offsetOf(cursor: string | null): number {
  if (!cursor) return 0;
  const n = Number.parseInt(cursor, 10);
  return Number.isInteger(n) && n >= 0 && String(n) === cursor ? n : 0;
}

function limitOf(value: string | null, fallback: number, max: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : fallback;
}

// The prepared search rows are rebuilt only when the list was refreshed.
const rowCache = new WeakMap<BusinessDatabase, { stamp: string; rows: SearchRow[] }>();

async function searchRows(db: BusinessDatabase): Promise<SearchRow[]> {
  const stamp = (((await db.get("meta", "medicinesUpdatedAt"))?.value as string | undefined) ?? "") + "|";
  const cached = rowCache.get(db);
  if (cached && cached.stamp === stamp) return cached.rows;
  const medicines = await db.getAll("medicines");
  medicines.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rows = medicines.map(normalizeRow);
  rowCache.set(db, { stamp, rows });
  return rows;
}

function toStore(s: StoredStore): Store {
  // Fields the device does not keep are filled with neutral values; the order screens only use the name and the contact line.
  return { id: s.id, name: s.name, contact_person: s.contact_person, phone: s.phone, address: s.address, notes: null, is_active: s.is_active, version: 0, created_at: "", updated_at: "" };
}

async function medicines(db: BusinessDatabase, params: URLSearchParams): Promise<LocalAnswer> {
  const rows = await searchRows(db);
  const offset = offsetOf(params.get("cursor"));
  const q = params.get("q");
  if (q !== null && q.trim() !== "") {
    const limit = limitOf(params.get("limit"), 30, 30);
    const found = filterMedicines(rows, parseQuery(q).words, offset + limit);
    const items = found.results.slice(offset);
    const page: MedicinePage = { items, next_cursor: found.more > 0 ? String(offset + limit) : null };
    return ok(page);
  }
  const limit = limitOf(params.get("limit"), MAX_PAGE, MAX_PAGE);
  const slice = rows.slice(offset, offset + limit).map((r) => r.medicine);
  const page: MedicinePage = { items: slice, next_cursor: offset + limit < rows.length ? String(offset + limit) : null };
  return ok(page);
}

async function stores(db: BusinessDatabase, params: URLSearchParams): Promise<LocalAnswer> {
  const status = params.get("status") ?? "active";
  const words = searchTokens(params.get("q") ?? "", 8);
  let all = await db.getAll("stores");
  if (status === "active") all = all.filter((s) => s.is_active);
  if (status === "inactive") all = all.filter((s) => !s.is_active);
  if (words.length > 0) {
    all = all.filter((s) => {
      const text = [s.name, s.contact_person, s.phone].map((p) => p ?? "").join(" ").toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }
  all.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
  const offset = offsetOf(params.get("cursor"));
  const limit = limitOf(params.get("limit"), 50, 100);
  const page = all.slice(offset, offset + limit).map(toStore);
  return ok({ items: page, next_cursor: offset + limit < all.length ? String(offset + limit) : null });
}

function summaryOf(draft: DraftRecord, storeName: string): OrderSummary & { device: { syncState: DraftRecord["syncState"]; neverSent: boolean } } {
  const server = draft.serverOrder;
  return {
    id: draft.orderId,
    order_number: server?.order_number ?? 0,
    status: "draft",
    source: "manual",
    created_at: server?.created_at ?? draft.updatedOnDevice,
    updated_at: draft.updatedOnDevice,
    confirmed_at: null,
    version: draft.baseVersion ?? 0,
    store: { id: draft.state.storeId, name: server?.store.name ?? storeName },
    line_count: draft.state.lines.length,
    priced_total: "0.00",
    unpriced_lines: 0,
    device: { syncState: draft.syncState, neverSent: draft.neverSent },
  };
}

async function orderList(db: BusinessDatabase, params: URLSearchParams): Promise<LocalAnswer> {
  const status = params.get("status");
  if (status !== null && status !== "draft") return ok({ items: [], next_cursor: null });
  const storeFilter = params.get("store_id");
  const storeRows = await db.getAll("stores");
  const names = new Map(storeRows.map((s) => [s.id, s.name]));
  const drafts = (await db.getAll("drafts")).filter((d) => d.syncState !== "synced" && (!storeFilter || d.state.storeId === storeFilter));
  drafts.sort((a, b) => b.seq - a.seq);
  const offset = offsetOf(params.get("cursor"));
  const limit = limitOf(params.get("limit"), 50, 100);
  const items = drafts.slice(offset, offset + limit).map((d) => summaryOf(d, names.get(d.state.storeId) ?? ""));
  return ok({ items, next_cursor: offset + limit < drafts.length ? String(offset + limit) : null });
}

/**
 * The answer from the device for this request, or null when this request is not answered locally (any other path or method,
 * or no database open): the caller then reports the real network error.
 */
export async function answerLocal(db: BusinessDatabase | null, method: string, pathWithQuery: string): Promise<LocalAnswer | null> {
  if (db === null || method.toUpperCase() !== "GET") return null;
  let url: URL;
  try {
    url = new URL(pathWithQuery, "http://device.local");
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, "");
  const params = url.searchParams;

  if (path === "/api/orders/medicines") return medicines(db, params);

  if (path === "/api/orders/usual") {
    const storeId = params.get("store_id") ?? "";
    const extras = await db.get("storeExtras", storeId);
    return extras ? ok(extras.usual) : notOnPhone("This store's usual medicines list");
  }

  if (path === "/api/orders/repeat") {
    const storeId = params.get("store_id") ?? "";
    const orderId = params.get("order_id") ?? "";
    const extras = await db.get("storeExtras", storeId);
    if (extras?.repeatPlan && extras.usual.source?.order_id === orderId) return ok(extras.repeatPlan);
    return notOnPhone("This store's last order");
  }

  if (path === "/api/stores") return stores(db, params);

  const storeMatch = /^\/api\/stores\/([^/]+)$/.exec(path);
  if (storeMatch) {
    const store = await db.get("stores", decodeURIComponent(storeMatch[1]!));
    return store ? ok(toStore(store)) : notFound("This store was not found.");
  }

  if (path === "/api/orders") return orderList(db, params);

  const orderMatch = /^\/api\/orders\/([^/]+)$/.exec(path);
  if (orderMatch) {
    const id = decodeURIComponent(orderMatch[1]!);
    if (id === "medicines" || id === "usual" || id === "repeat") return null;
    const draft = await db.get("drafts", id);
    // A never-sent order has no server copy: it is "not found" here and the editor recovers it from the journal.
    return draft?.serverOrder ? ok(draft.serverOrder as Order) : notFound("This order is not on the server.");
  }

  return null;
}
