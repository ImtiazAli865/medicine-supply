import type { Order } from "@/lib/orders/types";

// Shapes of the Module 004 API (see specs/004-pending-products/contracts/api.openapi.yaml).
// Money is always a decimal string with two decimals. Purchase price and MRP never appear here.

/** The public facts about a medicine that the pending screens need. No purchase price, no MRP. */
export interface MedicineBrief {
  id: string;
  name: string;
  unit: string;
  strength: string | null;
  dosage_form: string | null;
  pack_size: string | null;
  manufacturer: string | null;
  selling_price: string | null;
  is_active: boolean;
}

/** The result of registering a typed line or linking it to a medicine. */
export interface LinkResult {
  replayed: boolean;
  /** True when the line received the medicine's selling price (only after the supplier agreed). */
  price_applied: boolean;
  product: MedicineBrief;
  order: Order;
}

export interface PendingSummary {
  typed_lines: number;
  typed_groups: number;
  /** Items of the Need a price list: unpriced active medicines plus priced ones that still have waiting lines. */
  price_items: number;
  /** How many of those items have at least one confirmed line waiting for a price. */
  price_items_with_waiting_lines: number;
  lines_waiting: number;
}

export interface TypedLine {
  line_id: string;
  order_id: string;
  order_number: number;
  order_status: "draft" | "confirmed";
  store_id?: string;
  store_name: string;
  typed_text: string;
  quantity: number;
  unit: string;
}

export interface TypedGroup {
  typed_text: string;
  line_count: number;
  lines: TypedLine[];
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export interface Candidates {
  proposed: TypedLine[];
  not_proposed: TypedLine[];
}

export interface PriceItem {
  product_id: string;
  name: string;
  strength: string | null;
  dosage_form: string | null;
  pack_size: string | null;
  manufacturer: string | null;
  unit: string;
  selling_price: string | null;
  lines_waiting: number;
  orders_waiting: number;
}

export interface WaitingLine {
  line_id: string;
  order_id: string;
  order_number: number;
  store_name: string;
  quantity: number;
  line_total: string;
}

export interface PriceFillPreview {
  product: MedicineBrief;
  price: string;
  lines: WaitingLine[];
  untouched_priced_lines: number;
  total_waiting: number;
  batch_limit: number;
}

export interface PriceApplyResult {
  replayed: boolean;
  product: MedicineBrief;
  filled_count: number;
  orders_touched: number;
  filled: WaitingLine[];
}
