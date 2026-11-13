import { fetchJson } from "@/lib/api/client";
import type { MarketStatusFilter, PurchaseEntries, PurchaseResult } from "./types";

// Helpers for the market list screens: the query string of the list (also kept in the page address, so a reload
// or a shared link shows the same list) and the purchase requests.

export interface ListParams {
  date: string;
  q: string;
  status: MarketStatusFilter;
  stores: string[];
}

/** Only what differs from the defaults goes into the address. The date is always included. */
export function listQuery(params: ListParams): string {
  const search = new URLSearchParams();
  search.set("date", params.date);
  if (params.q.trim() !== "") search.set("q", params.q.trim());
  if (params.status !== "all") search.set("status", params.status);
  if (params.stores.length > 0) search.set("stores", params.stores.join(","));
  return search.toString();
}

export const marketListUrl = (params: ListParams) => `/api/market-list?${listQuery(params)}`;
export const marketPrintUrl = (params: ListParams) => `/market-list/print?${listQuery(params)}`;
export const marketExportUrl = (params: ListParams) => `/api/market-list/export?${listQuery(params)}`;
export const marketScreenUrl = (params: ListParams) => `/market-list?${listQuery(params)}`;

export const purchasesUrl = (product: string, unit: string, date: string) =>
  `/api/purchases?${new URLSearchParams({ product, unit, date }).toString()}`;

export interface RecordRequest {
  id: string;
  product_id: string;
  unit: string;
  purchase_date: string;
  quantity: number;
  unit_cost: string | null;
  supplier_name: string | null;
  reference: string | null;
}

/** Sends one purchase. Repeating a request with the same id returns the stored entry (replayed = true). */
export async function postPurchase(body: RecordRequest): Promise<PurchaseResult> {
  return (await fetchJson<PurchaseResult>("/api/purchases", { json: body })).data;
}

export async function postVoid(entryId: string, reason: string): Promise<PurchaseResult> {
  return (await fetchJson<PurchaseResult>(`/api/purchases/${entryId}/void`, { json: { reason } })).data;
}

export async function getPurchases(product: string, unit: string, date: string): Promise<PurchaseEntries> {
  return (await fetchJson<PurchaseEntries>(purchasesUrl(product, unit, date))).data;
}
