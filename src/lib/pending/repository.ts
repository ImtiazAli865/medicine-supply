import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, noBusiness, notFound, unusableId } from "@/lib/api/errors";
import { decodeCursor } from "@/lib/api/paging";
import { formatPKR } from "@/lib/money";
import type { Order } from "@/lib/orders/types";
import type { LinkBody, PendingListQuery, PriceApplyBody, RegisterBody } from "@/lib/validation/pending";
import type {
  Candidates,
  LinkResult,
  MedicineBrief,
  Page,
  PendingSummary,
  PriceApplyResult,
  PriceFillPreview,
  PriceItem,
  TypedGroup,
  WaitingLine,
} from "./types";

// Quick Register, linking and Pending Prices run only through database functions (migration 0004). The
// functions read the business from the signed-in user's session. A refusal comes back as a `reason` that is
// turned into the documented ApiError here, so every screen shows the same wording.

type FunctionResult = Record<string, unknown>;

async function call(supabase: SupabaseClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (error.message?.includes("no_business")) throw noBusiness();
    throw error;
  }
  return data;
}

const CHANGED_ELSEWHERE = "This order was changed elsewhere.";
const PRICE_HELP = "Enter an amount greater than zero with at most two decimals, like 125 or 125.50.";

/** Turns a refusal reason from a pending function into an ApiError. */
export function refusal(result: FunctionResult): ApiError {
  const reason = String(result.reason ?? "");
  const current = result.current as Order | undefined;
  const matches = result.matches as MedicineBrief[] | undefined;
  switch (reason) {
    case "version_conflict":
      return new ApiError("version_conflict", CHANGED_ELSEWHERE, { current });
    case "order_not_editable":
      return new ApiError("order_not_editable", "This order can no longer be changed.", { current });
    case "line_not_pending":
      return new ApiError("line_not_pending", "This line is already registered or linked.", { current });
    case "line_not_found":
      return new ApiError("line_not_found", "This line was not found on the order.");
    case "not_found":
    case "product_not_found":
      return notFound();
    case "product_inactive":
      return new ApiError("product_inactive", "This medicine is inactive. Reactivate it first or choose another medicine.");
    case "invalid_product": {
      const fields = (result.fields ?? {}) as Record<string, string>;
      const first = Object.values(fields)[0] ?? "Please check the medicine details.";
      // The form shows fields under "product" keys; the same keys are used by the validation schema.
      return new ApiError("validation_error", first, { fields });
    }
    case "unusable_id":
      return unusableId();
    case "duplicate_product":
      return new ApiError("duplicate_product", "This medicine already exists.", { matches });
    case "similar_products":
      return new ApiError("similar_products", "Similar medicines already exist. Confirm to create a separate product.", { matches });
    case "sku_conflict": {
      const name = matches?.[0]?.name ?? "another medicine";
      return new ApiError("sku_conflict", `This code (SKU) is already used by ${name}.`, {
        matches,
        fields: { sku: `This code (SKU) is already used by ${name}.` },
      });
    }
    case "list_changed":
      return new ApiError("list_changed", "The list of lines changed. Review it again.", {
        current_lines: (result.current_lines as WaitingLine[] | undefined) ?? [],
      });
    case "price_differs": {
      const price = String(result.current_price ?? "");
      return new ApiError(
        "price_differs",
        `This medicine already has a selling price of ${formatPKR(price)}. Change it on the Products screen.`,
        { current_price: price },
      );
    }
    case "invalid_price":
      return new ApiError("invalid_price", PRICE_HELP, { fields: { price: PRICE_HELP } });
    case "invalid_request":
      return new ApiError("validation_error", "Please check the request and try again.");
    default:
      return new ApiError("server_error", "Something went wrong. Please try again.");
  }
}

function pageOf<T>(result: FunctionResult): Page<T> {
  const next = result.next_offset;
  return { items: (result.items as T[]) ?? [], next_cursor: typeof next === "number" ? String(next) : null };
}

// ---------------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------------

export async function registerLine(supabase: SupabaseClient, orderId: string, lineId: string, input: RegisterBody): Promise<LinkResult> {
  const data = (await call(supabase, "pending_line_register", {
    p_order: orderId,
    p_line: lineId,
    p_request_id: input.request_id,
    p_expected_version: input.expected_version,
    p_product: input.product,
    p_confirm_similar: input.confirm_similar,
    p_apply_price: input.apply_price,
  })) as FunctionResult;
  if (data.done !== true) throw refusal(data);
  return {
    replayed: data.replayed === true,
    price_applied: data.price_applied === true,
    product: data.product as MedicineBrief,
    order: data.order as Order,
  };
}

export async function linkLine(supabase: SupabaseClient, orderId: string, lineId: string, input: LinkBody): Promise<LinkResult> {
  const data = (await call(supabase, "pending_line_link", {
    p_order: orderId,
    p_line: lineId,
    p_request_id: input.request_id,
    p_expected_version: input.expected_version,
    p_product_id: input.product_id,
    p_apply_price: input.apply_price,
    p_how: input.how,
  })) as FunctionResult;
  if (data.done !== true) throw refusal(data);
  return {
    replayed: data.replayed === true,
    price_applied: data.price_applied === true,
    product: data.product as MedicineBrief,
    order: data.order as Order,
  };
}

export async function applyPriceFill(supabase: SupabaseClient, productId: string, input: PriceApplyBody): Promise<PriceApplyResult> {
  const data = (await call(supabase, "pending_price_apply", {
    p_product: productId,
    p_price: input.price,
    p_request_id: input.request_id,
    p_line_ids: input.line_ids,
    p_fill_lines: input.fill_lines,
  })) as FunctionResult;
  if (data.done !== true) throw refusal(data);
  return {
    replayed: data.replayed === true,
    product: data.product as MedicineBrief,
    filled_count: Number(data.filled_count ?? 0),
    orders_touched: Number(data.orders_touched ?? 0),
    filled: (data.filled as WaitingLine[]) ?? [],
  };
}

// ---------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------

export async function pendingSummary(supabase: SupabaseClient): Promise<PendingSummary> {
  return (await call(supabase, "pending_summary", {})) as PendingSummary;
}

export async function listTypedGroups(supabase: SupabaseClient, query: Pick<PendingListQuery, "q" | "limit" | "cursor">): Promise<Page<TypedGroup>> {
  const data = (await call(supabase, "pending_typed_groups", {
    p_q: query.q === "" ? null : query.q,
    p_limit: query.limit,
    p_offset: decodeCursor(query.cursor),
  })) as FunctionResult;
  return pageOf<TypedGroup>(data);
}

export async function listPendingPrices(supabase: SupabaseClient, query: PendingListQuery): Promise<Page<PriceItem>> {
  const data = (await call(supabase, "pending_prices_list", {
    p_q: query.q === "" ? null : query.q,
    p_only_waiting: query.waiting === "1",
    p_limit: query.limit,
    p_offset: decodeCursor(query.cursor),
  })) as FunctionResult;
  return pageOf<PriceItem>(data);
}

export async function previewPriceFill(supabase: SupabaseClient, productId: string, price: string): Promise<PriceFillPreview> {
  const data = (await call(supabase, "pending_price_preview", { p_product: productId, p_price: price })) as FunctionResult;
  if (data.ok !== true) throw refusal(data);
  return {
    product: data.product as MedicineBrief,
    price: String(data.price),
    lines: (data.lines as WaitingLine[]) ?? [],
    untouched_priced_lines: Number(data.untouched_priced_lines ?? 0),
    total_waiting: Number(data.total_waiting ?? 0),
    batch_limit: Number(data.batch_limit ?? 1000),
  };
}

export async function pendingCandidates(supabase: SupabaseClient, productId: string): Promise<Candidates> {
  const data = (await call(supabase, "pending_candidates", { p_product: productId })) as FunctionResult;
  if (data.ok !== true) throw refusal(data);
  return { proposed: (data.proposed as Candidates["proposed"]) ?? [], not_proposed: (data.not_proposed as Candidates["not_proposed"]) ?? [] };
}
