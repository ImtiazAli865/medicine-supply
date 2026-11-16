// Shapes returned by the store account (ledger) functions (migration 0008) and by the route handlers
// (specs/007-store-accounts-payments/contracts/api.openapi.yaml). Money is always a decimal string with two
// decimals. A balance is a SIGNED string: positive means the store owes the supplier, negative means the store
// has paid in advance. No type here has a purchase price, MRP, cost, margin or profit field, because no ledger
// table has such a column.

export type EntryType = "opening_balance" | "invoice" | "payment" | "adjustment" | "reversal";

export type EntrySide = "debit" | "credit";

/** Derived, never stored. */
export type PaymentStatus = "unpaid" | "partially_paid" | "paid";

export type PaymentMethod = "cash";

/** The two ways an opening balance can point. */
export type OpeningDirection = "owes" | "advance";

/** The two ways an adjustment can change what a store owes. */
export type AdjustmentDirection = "reduce" | "increase";

export interface LedgerEntry {
  id: string;
  entry_type: EntryType;
  entry_date: string;
  debit: string;
  credit: string;
  side: EntrySide;
  /** The amount of the entry without a sign (the debit or the credit). */
  amount: string;
  note: string | null;
  reference: string | null;
  payment_method: string | null;
  invoice_id: string | null;
  /** INV-000001 form, for an entry that belongs to an invoice. */
  invoice_label: string | null;
  reverses_entry_id: string | null;
  /** True when a reversal entry points at this entry. */
  reversed: boolean;
  reversed_by_entry_id: string | null;
  /** The signed balance after this entry in (entry date, order of recording) order; only on the account and statement. */
  running_balance?: string;
  created_at: string;
  mine: boolean;
}

export type OpenItemKind = "opening_balance" | "invoice" | "adjustment";

/** A debit that is still counted (not reversed), with what the credits have settled so far. */
export interface OpenItem {
  kind: OpenItemKind;
  entry_id: string;
  invoice_id: string | null;
  label: string;
  date: string;
  amount: string;
  allocated: string;
  outstanding: string;
  status: PaymentStatus;
}

export interface AccountStore {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
}

export interface AccountView {
  store: AccountStore;
  balance: string;
  owes: boolean;
  advance: boolean;
  open_items: OpenItem[];
  entries: LedgerEntry[];
  total_entries: number;
}

export interface AccountRow {
  store_id: string;
  name: string;
  is_active: boolean;
  balance: string;
  owes: boolean;
  advance: boolean;
  entry_count: number;
  last_entry_date: string | null;
}

export interface AccountPage {
  items: AccountRow[];
  total: number;
}

export interface AccountsSummary {
  total_owed: string;
  stores_owing: number;
  total_advance: string;
  stores_with_advance: number;
}

export interface PaymentPreviewItem {
  kind: OpenItemKind;
  label: string;
  date: string;
  outstanding_before: string;
  applied: string;
  outstanding_after: string;
}

export interface PaymentPreview {
  valid: boolean;
  reason?: string;
  balance_before: string;
  balance_after: string;
  advance_after: string;
  settles: PaymentPreviewItem[];
}

export interface Statement {
  business: { name: string; phone: string | null; address: string | null };
  store: { id: string; name: string; contact_person: string | null; phone: string | null; address: string | null };
  from: string;
  to: string;
  opening_balance: string;
  entries: LedgerEntry[];
  total_debit: string;
  total_credit: string;
  closing_balance: string;
  /** True when the range holds more than 2,000 lines and the list was cut. */
  truncated: boolean;
  /** False (with a reason) when the dates are not a valid range. */
  valid?: boolean;
  reason?: string;
}

/** What a successful entry function returns. */
export interface EntryResult {
  done: true;
  replayed?: boolean;
  entry: LedgerEntry;
}

export interface PaymentResult extends EntryResult {
  account: { balance: string; advance: boolean };
}

/** The five figures saved with an issued invoice (also declared on the invoice type). */
export interface AccountSummarySnapshot {
  balance_date: string;
  previous_balance: string;
  previous_is_advance: boolean;
  this_invoice: string;
  payment_received: string | null;
  balance_due: string;
  due_is_advance: boolean;
}
