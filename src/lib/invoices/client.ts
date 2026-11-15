import { fetchJson } from "@/lib/api/client";
import { newId } from "@/lib/ids";
import type { Invoice, InvoicePage, InvoiceResult, InvoiceSummary, ToInvoicePage } from "./types";

// Helpers for the invoice screens: the query string of the list (also kept in the page address, so a reload or a
// shared link shows the same list) and the invoice requests. Every write that has a result waits for the server.

export type InvoiceTab = "invoices" | "to-invoice";

export interface InvoiceListParams {
  tab: InvoiceTab;
  status: "all" | "draft" | "issued" | "cancelled";
  store: string;
  from: string;
  to: string;
  q: string;
}

export const DEFAULT_LIST_PARAMS: InvoiceListParams = { tab: "invoices", status: "all", store: "", from: "", to: "", q: "" };

/** Only what differs from the defaults goes into the address. */
export function listQuery(params: InvoiceListParams): string {
  const search = new URLSearchParams();
  if (params.tab !== "invoices") search.set("tab", params.tab);
  if (params.status !== "all") search.set("status", params.status);
  if (params.store !== "") search.set("store", params.store);
  if (params.from !== "") search.set("from", params.from);
  if (params.to !== "") search.set("to", params.to);
  if (params.q.trim() !== "") search.set("q", params.q.trim());
  return search.toString();
}

export const invoicesScreenUrl = (params: InvoiceListParams = DEFAULT_LIST_PARAMS) => {
  const query = listQuery(params);
  return query === "" ? "/invoices" : `/invoices?${query}`;
};

export const invoiceUrl = (id: string) => `/invoices/${id}`;
export const invoicePrintUrl = (id: string, layout: "a4" | "thermal") => `/invoices/${id}/print?layout=${layout}`;
export const orderSheetUrl = (orderId: string) => `/orders/${orderId}/print`;

export function invoicesApiUrl(params: Pick<InvoiceListParams, "status" | "store" | "from" | "to" | "q">, page: { limit: number; offset: number }, order?: string): string {
  const search = new URLSearchParams();
  if (params.status !== "all") search.set("status", params.status);
  if (params.store !== "") search.set("store", params.store);
  if (params.from !== "") search.set("from", params.from);
  if (params.to !== "") search.set("to", params.to);
  if (order) search.set("order", order);
  if (params.q.trim() !== "") search.set("q", params.q.trim());
  search.set("limit", String(page.limit));
  search.set("offset", String(page.offset));
  return `/api/invoices?${search.toString()}`;
}

export function toInvoiceApiUrl(q: string, page: { limit: number; offset: number }): string {
  const search = new URLSearchParams();
  if (q.trim() !== "") search.set("q", q.trim());
  search.set("limit", String(page.limit));
  search.set("offset", String(page.offset));
  return `/api/invoices/to-invoice?${search.toString()}`;
}

/** Creates the draft of an order. The invoice id is created here and doubles as the request id (a repeat is safe). */
export async function postCreateInvoice(orderId: string, id: string = newId()): Promise<InvoiceResult> {
  return (await fetchJson<InvoiceResult>("/api/invoices", { json: { id, order_id: orderId } })).data;
}

export async function getInvoice(id: string): Promise<Invoice> {
  return (await fetchJson<Invoice>(`/api/invoices/${id}`)).data;
}

export async function patchQuantities(
  id: string,
  expectedVersion: number,
  lines: Array<{ line_id: string; delivered_quantity: number }>,
): Promise<InvoiceResult> {
  return (await fetchJson<InvoiceResult>(`/api/invoices/${id}`, { method: "PATCH", json: { expected_version: expectedVersion, lines } })).data;
}

export async function postRefresh(id: string, expectedVersion: number): Promise<InvoiceResult> {
  return (await fetchJson<InvoiceResult>(`/api/invoices/${id}/refresh`, { json: { expected_version: expectedVersion } })).data;
}

export async function postDiscard(id: string, expectedVersion: number): Promise<{ done: true; order_id: string }> {
  return (await fetchJson<{ done: true; order_id: string }>(`/api/invoices/${id}/discard`, { json: { expected_version: expectedVersion } })).data;
}

export async function postIssue(id: string, expectedVersion: number): Promise<InvoiceResult> {
  return (await fetchJson<InvoiceResult>(`/api/invoices/${id}/issue`, { json: { expected_version: expectedVersion } })).data;
}

export async function postCancel(id: string, reason: string): Promise<InvoiceResult> {
  return (await fetchJson<InvoiceResult>(`/api/invoices/${id}/cancel`, { json: { reason } })).data;
}

export async function getInvoicePage(url: string): Promise<InvoicePage> {
  return (await fetchJson<InvoicePage>(url)).data;
}

export async function getToInvoicePage(url: string): Promise<ToInvoicePage> {
  return (await fetchJson<ToInvoicePage>(url)).data;
}

export async function getInvoiceSummary(): Promise<InvoiceSummary> {
  return (await fetchJson<InvoiceSummary>("/api/invoices/summary")).data;
}
