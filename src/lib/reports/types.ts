// Response shapes of the Module 010 report routes. They mirror specs/010-reports-profit/contracts/api.openapi.yaml.
// Money is always a decimal string with two decimals ("125.50", "-12.00"); the browser formats it and never adds it up.
// These are the ONLY response types in the application that carry a cost or a profit: nothing customer-facing, offline
// or backed up may import this file (guarded by tests/unit/reports-no-leak.test.ts).

export type ReportGroup = "day" | "week" | "month";
export type ReportSort = "sales" | "profit" | "name";
export type FigureStatus = "complete" | "incomplete";

export interface ReportPeriod {
  from: string;
  to: string;
  group: ReportGroup;
  generated_at: string;
}

/** An estimated or a realized figure over the lines that have a cost. `profit` is null when no line has a cost. */
export interface ProfitFigure {
  cost: string;
  covered_sales: string;
  profit: string | null;
  missing_lines: number;
  missing_sales: string;
  status: FigureStatus;
}

export interface SalesBucket {
  bucket_start: string;
  bucket_end: string;
  partial: boolean;
  sales: string;
  invoices: number;
  estimated: ProfitFigure;
  realized: ProfitFigure;
}

export interface SalesReport {
  period: ReportPeriod;
  totals: { sales: string; invoices: number; lines: number; quantity: number };
  estimated: ProfitFigure;
  realized: ProfitFigure;
  excluded: { cancelled_invoices: number; draft_invoices: number };
  series: SalesBucket[];
}

export interface PurchaseBucket {
  bucket_start: string;
  bucket_end: string;
  partial: boolean;
  cost: string;
  entries: number;
  entries_without_cost: number;
}

export interface PurchaseReport {
  period: ReportPeriod;
  totals: {
    cost: string;
    entries: number;
    entries_with_cost: number;
    entries_without_cost: number;
    quantity_without_cost: number;
    cancelled_entries_left_out: number;
    status: FigureStatus;
  };
  series: PurchaseBucket[];
}

/** Whole-period or filtered totals of a list: sales and both figures. */
export interface ListTotals {
  sales: string;
  invoices: number;
  estimated: ProfitFigure;
  realized: ProfitFigure;
}

export interface StoreRow {
  store_id: string;
  name: string;
  sales: string;
  invoices: number;
  share: string;
  estimated: ProfitFigure;
  realized: ProfitFigure;
}

export interface StoreReport {
  period: ReportPeriod;
  items: StoreRow[];
  total: number;
  totals: ListTotals;
  filtered_totals: ListTotals;
}

export interface MedicineRow {
  key: string;
  product_id: string | null;
  name: string;
  typed_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  pack_size: string | null;
  manufacturer: string | null;
  unit: string;
  billed_quantity: number;
  sales: string;
  estimated: ProfitFigure;
  realized: ProfitFigure;
}

export interface MedicineReport {
  period: ReportPeriod;
  items: MedicineRow[];
  /** The "Not registered" group: lines billed under a typed name, by exact typed text. */
  typed_rows: MedicineRow[];
  total: number;
  totals: ListTotals;
  filtered_totals: ListTotals;
}

export type CostMissingReason = "no_purchase_price_saved" | "no_purchase_on_market_day" | "typed_line" | "unit_differs";

export interface CostMissingRow {
  product_id: string | null;
  name: string;
  strength: string | null;
  dosage_form: string | null;
  pack_size: string | null;
  manufacturer: string | null;
  unit: string;
  sales_amount: string;
  billed_quantity: number;
  lines: number;
  estimate_missing: boolean;
  realized_missing: boolean;
  realized_dates: string[];
  reason: CostMissingReason;
}

export interface CostMissingReport {
  period: ReportPeriod;
  items: CostMissingRow[];
  total: number;
  /** True when there are more than 500 medicines; the first 500 (largest sales first) are listed. */
  truncated: boolean;
}

export interface NotInAccount {
  invoices: number;
  total: string;
}
