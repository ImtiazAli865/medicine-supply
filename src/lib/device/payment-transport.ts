import { ClientApiError, fetchJson } from "@/lib/api/client";
import { conflictFromAnswer, type PaymentSendResult } from "./payments";
import type { PaymentOpRecord } from "./schema";

// Sends one waiting payment to the server with the key the phone made for it, so sending it twice records it once (Module 011,
// contracts/offline-payments.md). It always posts to the account of the store the payment was recorded with, never to another.
// The server's reply is read only to learn whether the payment is recorded; nothing else of it is used or kept on the phone.
// A 401 never navigates the person away from the screen: it comes back as `unauthorized`.

const RETRY_STATUSES = new Set([408, 425, 429]);

export async function sendPaymentTransport(op: PaymentOpRecord): Promise<PaymentSendResult> {
  const body = { id: op.paymentId, amount: op.amount, date: op.date, method: "cash", reference: op.reference };
  try {
    await fetchJson<{ done: boolean }>(`/api/accounts/${op.storeId}/payments`, { json: body, onUnauthorized: "event" });
    return { kind: "ok" };
  } catch (error) {
    if (error instanceof ClientApiError) {
      if (error.code === "unauthenticated") return { kind: "unauthorized" };
      if (error.code === "network" || error.status >= 500 || RETRY_STATUSES.has(error.status)) return { kind: "retryable", message: error.message };
      const conflict = conflictFromAnswer({ code: error.code, status: error.status });
      if (conflict === "not_found") return { kind: "conflict", conflict, message: "This store is not on the server." };
      if (conflict === "request_reused") {
        return { kind: "conflict", conflict, message: "A payment with this key but other details already exists. Check the store's account." };
      }
      // A refusal of the amount, the date or the reference, or any other answer that says this payment cannot be recorded as it is.
      const reason = error.fields?.amount ?? error.fields?.date ?? error.fields?.reference ?? error.message;
      return { kind: "conflict", conflict: "refused", message: reason };
    }
    throw error;
  }
}
