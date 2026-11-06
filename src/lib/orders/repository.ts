import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, notFound, unusableId } from "@/lib/api/errors";
import { decodeCursor, slicePage } from "@/lib/api/paging";
import type { OrderActionBody, OrderCancelBody, OrderListQuery, OrderSaveBody } from "@/lib/validation/order";
import type { Order, OrderPage, OrderResult, OrderSummary } from "./types";

// Orders are read and written only through database functions (migration 0003). Writes run as the
// signed-in user's session, the function reads the business from it, and a refusal comes back as a
// `reason` that is turned into the documented ApiError here.

type FunctionResult = Record<string, unknown>;

async function call(supabase: SupabaseClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

const CHANGED_ELSEWHERE = "This order was changed elsewhere.";

/** Turns a refusal reason from an order function into an ApiError. */
function refusal(result: FunctionResult): ApiError {
  const reason = String(result.reason ?? "");
  const current = result.current as Order | undefined;
  const detail = (result.detail ?? {}) as { message?: string };
  switch (reason) {
    case "version_conflict":
      return new ApiError("version_conflict", CHANGED_ELSEWHERE, { current });
    case "order_not_editable":
      return new ApiError("order_not_editable", "This order can no longer be changed.", { current });
    case "store_locked":
      return new ApiError(
        "store_locked",
        "The store cannot be changed once an order has lines. Start a new order for another store.",
        { current },
      );
    case "order_empty":
      return new ApiError("order_empty", "Add at least one medicine before confirming the order.");
    case "not_found":
      return notFound();
    case "store_not_found":
      return new ApiError("validation_error", "This store was not found.", { fields: { store_id: "This store was not found." } });
    case "store_inactive":
      return new ApiError("validation_error", "This store is inactive.", {
        fields: { store_id: "This store is inactive. Choose another store." },
      });
    case "invalid_lines": {
      const message = detail.message ?? "Please check the medicines on this order.";
      return new ApiError("validation_error", message, { fields: { lines: message } });
    }
    case "reason_required":
      return new ApiError("validation_error", "Enter a reason for cancelling a confirmed order.", {
        fields: { reason: "Enter a reason for cancelling a confirmed order." },
      });
    case "reason_too_long":
      return new ApiError("validation_error", "The reason is too long.", { fields: { reason: "Reason can be at most 500 characters." } });
    case "unusable_id":
      return unusableId();
    default:
      return new ApiError("server_error", "Something went wrong. Please try again.");
  }
}

export async function getOrder(supabase: SupabaseClient, id: string): Promise<Order | null> {
  const data = await call(supabase, "order_get", { p_id: id });
  return (data as Order | null) ?? null;
}

/** One page of the history, newest first. The database function returns limit + 1 rows. */
export async function listOrders(supabase: SupabaseClient, query: OrderListQuery): Promise<OrderPage> {
  const offset = decodeCursor(query.cursor);
  const data = await call(supabase, "order_list", {
    p_store: query.store_id ?? null,
    p_status: query.status ?? null,
    p_from: query.from ?? null,
    p_to: query.to ?? null,
    p_q: query.q ?? "",
    p_limit: query.limit,
    p_offset: offset,
  });
  return slicePage((data as OrderSummary[] | null) ?? [], offset, query.limit);
}

/** Creates a draft, updates a draft, or saves edits to a confirmed order. Safe to repeat with the same request id. */
export async function saveOrder(
  supabase: SupabaseClient,
  id: string,
  input: OrderSaveBody,
): Promise<{ result: OrderResult; created: boolean }> {
  const data = (await call(supabase, "order_save", {
    p_id: id,
    p_request_id: input.request_id,
    p_expected_version: input.expected_version,
    p_store_id: input.store_id,
    p_notes: input.notes,
    p_lines: input.lines,
  })) as FunctionResult;

  if (data.saved !== true) throw refusal(data);
  return {
    result: { replayed: data.replayed === true, order: data.order as Order },
    created: data.created === true,
  };
}

export async function confirmOrder(supabase: SupabaseClient, id: string, input: OrderActionBody): Promise<OrderResult> {
  const data = (await call(supabase, "order_confirm", {
    p_id: id,
    p_request_id: input.request_id,
    p_expected_version: input.expected_version,
  })) as FunctionResult;
  if (data.confirmed !== true) throw refusal(data);
  return { replayed: data.replayed === true, order: data.order as Order };
}

export async function cancelOrder(supabase: SupabaseClient, id: string, input: OrderCancelBody): Promise<OrderResult> {
  const data = (await call(supabase, "order_cancel", {
    p_id: id,
    p_request_id: input.request_id,
    p_expected_version: input.expected_version,
    p_reason: input.reason,
  })) as FunctionResult;
  if (data.cancelled !== true) throw refusal(data);
  return { replayed: data.replayed === true, order: data.order as Order };
}
