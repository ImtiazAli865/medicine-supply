import { fetchJson } from "@/lib/api/client";
import type { Order, OrderResult } from "@/lib/orders/types";
import { toOrderLines, type PreviewState } from "./preview-state";
import type { DiagnosticPage, ParserKind, Preview } from "./types";

// Browser helpers for voice order entry. Every write waits for the server before the screen says it worked.

/** Asks the server to turn the transcript into a preview. Nothing is saved. */
export async function postParse(body: { transcript: string; parser: ParserKind }, signal?: AbortSignal): Promise<Preview> {
  return (await fetchJson<Preview>("/api/voice/parse", { json: body, signal })).data;
}

/**
 * Creates the draft order from the reviewed preview through the existing order save. The order id, the request id and
 * every line id were made when the preview opened, so a double tap, a refresh or a retry is the same request and
 * creates one order. The order is a draft; it is never confirmed, priced or invoiced here.
 */
export async function createVoiceDraft(state: PreviewState, spokenText: string): Promise<{ order: Order; replayed: boolean }> {
  if (!state.store.storeId) throw new Error("A store is required.");
  const { data } = await fetchJson<OrderResult>(`/api/orders/${state.orderId}`, {
    method: "PUT",
    json: {
      request_id: state.requestId,
      expected_version: null,
      store_id: state.store.storeId,
      notes: null,
      lines: toOrderLines(state),
      source: "voice",
      spoken_text: spokenText,
    },
  });
  return { order: data.order, replayed: data.replayed };
}

export const diagnosticsUrl = (limit: number, offset: number) => `/api/voice/diagnostics?limit=${limit}&offset=${offset}`;

export async function getDiagnostics(url: string): Promise<DiagnosticPage> {
  return (await fetchJson<DiagnosticPage>(url)).data;
}
