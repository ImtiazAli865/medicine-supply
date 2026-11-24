import { ClientApiError, fetchJson } from "@/lib/api/client";
import type { SaveRequest } from "./autosave";
import { toSaveInput, type EditorState } from "./editor-state";
import type { Order, OrderResult } from "./types";
import type { SendResult } from "@/lib/device/sync-center";

// The one place where an order save request is sent to the server and its answer is sorted into what the autosave machine
// understands (ok, conflict, retryable, fatal) plus "unauthorized" for the sync centre. Used by the order editor (a 401
// takes the person to sign-in as before) and by the sync centre (a 401 only pauses sending, the person stays where they are).

export type UnauthorizedMode = "redirect" | "event";

export async function sendSaveRequest(orderId: string, request: SaveRequest<EditorState>, onUnauthorized: UnauthorizedMode = "redirect"): Promise<SendResult> {
  try {
    const { data } = await fetchJson<OrderResult>(`/api/orders/${orderId}`, {
      method: "PUT",
      json: toSaveInput(request.state, request.requestId, request.expectedVersion),
      onUnauthorized,
    });
    return { kind: "ok", version: data.order.version, savedAt: data.order.updated_at, order: data.order };
  } catch (error) {
    if (error instanceof ClientApiError) {
      if (error.code === "unauthenticated") {
        return onUnauthorized === "event" ? { kind: "unauthorized" } : { kind: "fatal", message: error.message };
      }
      if (error.code === "version_conflict" || error.code === "order_not_editable" || error.code === "store_locked") {
        return error.current ? { kind: "conflict", current: error.current as Order } : { kind: "fatal", message: error.message };
      }
      if (error.code === "network" || error.status >= 500) return { kind: "retryable", message: error.message };
      return { kind: "fatal", message: error.fields?.lines ?? error.fields?.store_id ?? error.message };
    }
    throw error;
  }
}

/** The transport of the sync centre: a 401 never navigates away. */
export function saveOrderTransport(orderId: string, request: SaveRequest<EditorState>): Promise<SendResult> {
  return sendSaveRequest(orderId, request, "event");
}
