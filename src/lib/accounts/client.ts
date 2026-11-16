import { fetchJson } from "@/lib/api/client";
import { newId } from "@/lib/ids";
import type {
  AccountPage,
  AccountsSummary,
  AccountView,
  AdjustmentDirection,
  EntryResult,
  OpeningDirection,
  PaymentPreview,
  PaymentResult,
} from "./types";

// Helpers for the store account screens. Every write has a client-created entry id, created ONCE per open form
// (by the form that owns it) and sent unchanged on every retry, so a double tap, a refresh or a slow network
// records the entry once. Every write waits for the server before the screen says it worked.

export const accountsScreenUrl = (q = "", onlyOwing = false) => {
  const search = new URLSearchParams();
  if (q.trim() !== "") search.set("q", q.trim());
  if (onlyOwing) search.set("owing", "1");
  const text = search.toString();
  return text === "" ? "/accounts" : `/accounts?${text}`;
};
export const accountUrl = (storeId: string) => `/accounts/${storeId}`;
export const statementUrl = (storeId: string, from?: string, to?: string) => {
  const search = new URLSearchParams();
  if (from) search.set("from", from);
  if (to) search.set("to", to);
  const text = search.toString();
  return text === "" ? `/accounts/${storeId}/statement` : `/accounts/${storeId}/statement?${text}`;
};

export function accountsApiUrl(params: { q: string; onlyOwing: boolean }, page: { limit: number; offset: number }): string {
  const search = new URLSearchParams();
  if (params.q.trim() !== "") search.set("q", params.q.trim());
  if (params.onlyOwing) search.set("only_owing", "true");
  search.set("limit", String(page.limit));
  search.set("offset", String(page.offset));
  return `/api/accounts?${search.toString()}`;
}

export function accountApiUrl(storeId: string, page: { limit: number; offset: number }): string {
  return `/api/accounts/${storeId}?limit=${page.limit}&offset=${page.offset}`;
}

/** A new entry id: create one per open form, not per tap. */
export const newEntryId = (): string => newId();

export async function getAccountsPage(url: string): Promise<AccountPage> {
  return (await fetchJson<AccountPage>(url)).data;
}

export async function getAccountsSummary(): Promise<AccountsSummary> {
  return (await fetchJson<AccountsSummary>("/api/accounts/summary")).data;
}

export async function getAccount(url: string): Promise<AccountView> {
  return (await fetchJson<AccountView>(url)).data;
}

export async function getPaymentPreview(storeId: string, amount: string, signal?: AbortSignal): Promise<PaymentPreview> {
  return (await fetchJson<PaymentPreview>(`/api/accounts/${storeId}/payment-preview?amount=${encodeURIComponent(amount)}`, { signal })).data;
}

export async function postPayment(
  storeId: string,
  body: { id: string; amount: string; date: string; reference: string | null },
): Promise<PaymentResult> {
  return (await fetchJson<PaymentResult>(`/api/accounts/${storeId}/payments`, { json: { ...body, method: "cash" } })).data;
}

export async function postOpeningBalance(
  storeId: string,
  body: { id: string; amount: string; direction: OpeningDirection; as_on: string; note: string | null },
): Promise<EntryResult> {
  return (await fetchJson<EntryResult>(`/api/accounts/${storeId}/opening-balances`, { json: body })).data;
}

export async function postAdjustment(
  storeId: string,
  body: { id: string; amount: string; direction: AdjustmentDirection; reason: string; date: string | null },
): Promise<EntryResult> {
  return (await fetchJson<EntryResult>(`/api/accounts/${storeId}/adjustments`, { json: body })).data;
}

export async function postReverse(storeId: string, entryId: string, body: { id: string; reason: string }): Promise<EntryResult> {
  return (await fetchJson<EntryResult>(`/api/accounts/${storeId}/entries/${entryId}/reverse`, { json: body })).data;
}
