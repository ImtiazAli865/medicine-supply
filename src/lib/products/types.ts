export interface Product {
  id: string;
  name: string;
  unit: string;
  brand: string | null;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  manufacturer: string | null;
  pack_size: string | null;
  sku: string | null;
  purchase_price: string | null;
  selling_price: string | null;
  mrp: string | null;
  /** selling_price - purchase_price; null when either is missing. Internal screens only. */
  unit_gross_profit: string | null;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export type ProductWarning = "selling_below_purchase" | "mrp_below_selling";

export interface ProductResult {
  product: Product;
  warnings: ProductWarning[];
}

export interface ProductPage {
  items: Product[];
  next_cursor: string | null;
}

export const COMMON_UNITS = ["strip", "bottle", "box", "tablet", "vial", "tube", "sachet"] as const;
