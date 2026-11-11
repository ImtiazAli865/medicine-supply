// Shapes returned by the order API (see specs/003-manual-orders/contracts/api.openapi.yaml).
// Money is always a decimal string with two decimals. Purchase price and MRP are never part of any
// of these types: they are stored in the snapshot but never leave the database.

export type OrderStatus = "draft" | "confirmed" | "cancelled" | "fulfilled";
export type OrderSource = "manual" | "voice";
export type ItemStatus = "registered" | "pending_registration";

/** current = live catalog price (draft only); snapshot = recorded at confirm; none = no selling price. */
export type PriceBasis = "current" | "snapshot" | "none";

export interface OrderLine {
  id: string;
  position: number;
  product_id: string | null;
  item_status: ItemStatus;
  name: string;
  strength: string | null;
  dosage_form: string | null;
  pack_size: string | null;
  manufacturer: string | null;
  quantity: number;
  unit: string;
  delivered_quantity: number | null;
  price_basis: PriceBasis;
  selling_price: string | null;
  line_total: string | null;
  product_is_active: boolean | null;
}

export interface OrderTotals {
  priced_total: string;
  priced_lines: number;
  unpriced_lines: number;
  line_count: number;
}

export type OrderEventType = "created" | "confirmed" | "edited" | "cancelled";

export interface OrderEvent {
  id: string;
  event_type: OrderEventType;
  order_version: number;
  created_at: string;
  detail: Record<string, unknown>;
}

export interface OrderStore {
  id: string;
  name: string;
  is_active: boolean;
}

export interface Order {
  id: string;
  order_number: number;
  status: OrderStatus;
  source: OrderSource;
  notes: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  store: OrderStore;
  lines: OrderLine[];
  totals: OrderTotals;
  events: OrderEvent[];
}

export interface OrderSummary {
  id: string;
  order_number: number;
  status: OrderStatus;
  source: OrderSource;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  version: number;
  store: { id: string; name: string };
  line_count: number;
  priced_total: string;
  unpriced_lines: number;
}

export interface OrderPage {
  items: OrderSummary[];
  next_cursor: string | null;
}

/** One line as the screen edits it and as the save request sends it. */
export interface OrderLineInput {
  id: string;
  /** null for a typed (not registered) line. */
  product_id: string | null;
  /** The exact typed name; only for a typed line (null for a catalog line). */
  name: string | null;
  quantity: number;
  unit: string;
}

export interface OrderSaveInput {
  request_id: string;
  expected_version: number | null;
  store_id: string;
  notes: string | null;
  lines: OrderLineInput[];
}

export interface OrderResult {
  replayed: boolean;
  order: Order;
}
