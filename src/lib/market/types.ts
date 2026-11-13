// Shapes returned by the market list and purchase API (see specs/005-market-list-purchases/contracts/api.openapi.yaml).
// The market list types carry no price, cost or MRP field at all: the list, its summary, the print page and the
// CSV must never show them. Only a purchase entry carries the actual unit cost the supplier typed, and it is used
// only by the purchase recording screens.

export type PurchaseStatus = "not_bought" | "partly_bought" | "fully_bought" | "bought_extra";

export interface StoreQuantity {
  store_id: string;
  store_name: string;
  quantity: number;
}

/** A registered medicine and unit (product_id set), or a typed line group (product_id null, typed_name set). */
export interface MarketRow {
  /** Stable for the day: "<product id>:<unit>" or "typed:<normalized text>:<unit>". */
  key: string;
  product_id: string | null;
  name: string | null;
  typed_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  pack_size: string | null;
  manufacturer: string | null;
  unit: string;
  /** The whole day, all stores. */
  total_requested: number;
  /** Only the selected stores (equal to total_requested when no store is selected). */
  shown_requested: number;
  purchased: number;
  remaining: number;
  extra: number;
  status: PurchaseStatus;
  /** False for typed rows: register or link the medicine first. */
  can_record: boolean;
  stores: StoreQuantity[];
}

export interface MarketStore {
  id: string;
  name: string;
}

export interface MarketTotals {
  requested: number;
  purchased: number;
  remaining: number;
  rows: number;
  typed_rows: number;
}

export interface MarketList {
  date: string;
  generated_at: string;
  business_name: string | null;
  stores: MarketStore[];
  rows: MarketRow[];
  typed_rows: MarketRow[];
  totals: MarketTotals;
  truncated: boolean;
}

export interface MarketSummary {
  date: string;
  rows_total: number;
  rows_to_buy: number;
  typed_rows: number;
  typed_to_buy: number;
}

export type MarketStatusFilter = "all" | "to_buy" | "bought";

export interface PurchaseVoid {
  reason: string;
  voided_at: string;
  by_me: boolean;
}

export interface PurchaseEntry {
  id: string;
  product_id: string;
  unit: string;
  purchase_date: string;
  quantity: number;
  /** PKR with two decimals; null when the cost was not recorded. Never shown on the list, print or CSV. */
  unit_cost: string | null;
  supplier_name: string | null;
  reference: string | null;
  created_at: string;
  recorded_by_me: boolean;
  cancelled: boolean;
  void: PurchaseVoid | null;
}

export interface PurchaseEntries {
  entries: PurchaseEntry[];
  purchased: number;
  requested: number;
}

export interface PurchaseResult {
  done: boolean;
  replayed: boolean;
  entry: PurchaseEntry;
}
