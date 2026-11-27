// Shapes returned by the order API (see specs/003-manual-orders/contracts/api.openapi.yaml).
// Money is always a decimal string with two decimals. Purchase price and MRP are never part of any
// of these types: they are stored in the snapshot but never leave the database.

export type OrderStatus = "draft" | "confirmed" | "cancelled" | "fulfilled";
export type OrderSource = "manual" | "voice";
export type ItemStatus = "registered" | "pending_registration";

/** current = live catalog price (draft only); snapshot = recorded at confirm; none = no selling price. */
export type PriceBasis = "current" | "snapshot" | "none";

import type { PriceSource, RateInfo } from "./price";

export interface OrderLine {
  id: string;
  position: number;
  product_id: string | null;
  item_status: ItemStatus;
  name: string;
  /** The exact text the supplier typed; set when a typed line was linked to a medicine (Module 004), otherwise null. */
  typed_name: string | null;
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
  /** Where the price comes from (Module 012). Optional: an order saved on a phone before Module 012 has none. */
  price_source?: PriceSource | null;
  /** The price typed for this order; only on a draft. */
  chosen_price?: string | null;
  /** The medicine's catalog selling price now; only on a draft. */
  catalog_price?: string | null;
  /** The medicine's own unit; only on a draft. */
  product_unit?: string | null;
  /** The order store's rate for this medicine and unit; only on a draft. */
  rate?: RateInfo | null;
}

export interface OrderTotals {
  priced_total: string;
  priced_lines: number;
  unpriced_lines: number;
  line_count: number;
}

export type OrderEventType = "created" | "confirmed" | "edited" | "cancelled" | "linked" | "price_filled" | "invoiced" | "invoice_cancelled";

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
  /** Module 012. Absent: keep what the line has. null: automatic. A two-decimal string: the price typed for this order. */
  price?: string | null;
  /** Remember `price` as the store's rate for this medicine. */
  remember?: boolean;
  /** The rate version the screen saw (null when it saw none). */
  rate_version?: number | null;
  /** For a line added to a confirmed order: the price the screen showed. */
  expected_price?: string | null;
}

export interface OrderSaveInput {
  request_id: string;
  expected_version: number | null;
  store_id: string;
  notes: string | null;
  lines: OrderLineInput[];
}

/** A rate that was not remembered because it changed meanwhile (the order itself was saved). */
export interface RateConflict {
  product_id: string;
  current_rate: string | null;
  current_version: number | null;
}

export interface OrderResult {
  replayed: boolean;
  order: Order;
  rate_conflicts?: RateConflict[];
}
