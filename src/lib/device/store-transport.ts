import { ClientApiError, fetchJson } from "@/lib/api/client";
import type { StoreOpPayload } from "./schema";
import type { StoreSendResult } from "./sync-center";

// Creates a store that was made on the phone, with the id the phone made for it, so sending it twice gives one store (Module 009).
// A store whose name is similar to an existing one is NOT created and NOT merged: the answer says so and the supplier decides.
// A 401 never navigates the person away from the screen.

export async function saveStoreTransport(payload: StoreOpPayload, confirmDuplicate: boolean): Promise<StoreSendResult> {
  try {
    await fetchJson("/api/stores", {
      json: {
        id: payload.id,
        name: payload.name,
        contact_person: payload.contact_person,
        phone: payload.phone,
        address: payload.address,
        notes: payload.notes,
        confirm_duplicate: confirmDuplicate,
      },
      onUnauthorized: "event",
    });
    return { kind: "ok" };
  } catch (error) {
    if (error instanceof ClientApiError) {
      if (error.code === "unauthenticated") return { kind: "unauthorized" };
      if (error.code === "similar_store") {
        const matches = ((error.matches ?? []) as Array<{ id: string; name: string }>).map((m) => ({ id: m.id, name: m.name }));
        return { kind: "similar", matches };
      }
      if (error.code === "network" || error.status >= 500) return { kind: "retryable", message: error.message };
      return { kind: "fatal", message: error.fields?.name ?? error.message };
    }
    throw error;
  }
}
