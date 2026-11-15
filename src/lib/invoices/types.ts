// Shapes returned by the invoice functions (migration 0007) and by the route handlers (contracts/api.openapi.yaml).
// Money is always a decimal string with two decimals. No type here has a purchase price, MRP, cost, margin or
// profit field, because no invoice table has such a column.

import type { OrderStatus } from "@/lib/orders/types";

export type InvoiceStatus = "draft" | "issued" | "cancelled";

export type InvoiceEventType = "created" | "edited" | "refreshed" | "issued" | "cancelled" | "discarded";

export type BlockerReason = "typed" | "needs_price";

export interface Blocker {
  line_id: string;
  name: string;
  reason: BlockerReason;
}

export interface InvoiceLine {
  id: string;
  position: number;
  name: string;
  strength: string | null;
  dosage_form: string | null;
  pack_size: string | null;
  manufacturer: string | null;
  unit: string;
  ordered_quantity: number;
  delivered_quantity: number;
  selling_price: string | null;
  line_total: string | null;
  /** True when the delivered quantity is above 0. */
  billed: boolean;
  /** True when the line is billed but has no verified selling price. */
  needs_price: boolean;
  /** True for a typed (not registered) line. */
  typed: boolean;
  more_than_ordered: boolean;
}

export interface InvoiceEvent {
  id: string;
  event_type: InvoiceEventType;
  created_at: string;
  mine: boolean;
  detail: Record<string, unknown>;
}

export interface InvoiceBusiness {
  name: string;
  phone: string | null;
  address: string | null;
}

export interface InvoiceStore {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
}

export interface Invoice {
  id: string;
  order_id: string;
  order_number: number;
  order_status: OrderStatus;
  status: InvoiceStatus;
  invoice_number: number | null;
  /** INV-000001 form; null for a draft. */
  number_label: string | null;
  invoice_date: string | null;
  issued_at: string | null;
  issued_by_me?: boolean;
  cancelled_at: string | null;
  cancel_reason: string | null;
  version: number;
  /** A draft whose order changed after its lines were built. */
  stale: boolean;
  ready_to_issue: boolean;
  nothing_to_bill: boolean;
  blockers: Blocker[];
  grand_total: string;
  business: InvoiceBusiness;
  store: InvoiceStore;
  lines: InvoiceLine[];
  events?: InvoiceEvent[];
}

/** What a successful write function returns. */
export interface InvoiceResult {
  done: true;
  created?: boolean;
  replayed?: boolean;
  existing?: boolean;
  invoice: Invoice;
}

export interface InvoiceSummaryRow {
  id: string;
  status: InvoiceStatus;
  number_label: string | null;
  invoice_date: string | null;
  order_id: string;
  order_number: number;
  store_id: string;
  store_name: string;
  grand_total: string;
  created_at: string;
}

export interface InvoicePage {
  items: InvoiceSummaryRow[];
  total: number;
}

export interface ToInvoiceRow {
  order_id: string;
  order_number: number;
  store_id: string;
  store_name: string;
  confirmed_at: string;
  line_count: number;
  lines_without_price: number;
  draft_invoice_id: string | null;
}

export interface ToInvoicePage {
  items: ToInvoiceRow[];
  total: number;
}

export interface InvoiceSummary {
  to_invoice: number;
  drafts: number;
  issued_today: number;
}

/** One line of an order sheet (options A and B). Quantities and units only, never a price. */
export interface OrderSheetLine {
  position: number;
  name: string;
  strength: string | null;
  dosage_form: string | null;
  pack_size: string | null;
  manufacturer: string | null;
  quantity: number;
  unit: string;
  /** True for a typed line that has no registered medicine. */
  unregistered: boolean;
}

/** One order of one store: one section of an order sheet. */
export interface OrderSheetSection {
  order_id: string;
  order_number: number;
  order_date: string;
  store: { id: string; name: string; contact_person: string | null; phone: string | null; address: string | null };
  lines: OrderSheetLine[];
}

export interface OrderSheet {
  business: InvoiceBusiness;
  sections: OrderSheetSection[];
}
