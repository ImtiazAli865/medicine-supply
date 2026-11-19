// Shapes returned by the fast order entry routes (Module 008, see specs/008-fast-order-entry/contracts).
// They never contain a purchase price, MRP, cost, margin, profit, balance, invoice value or price snapshot:
// SLIM_MEDICINE_KEYS is the single list of columns the server selects, so the type and the query cannot drift.

export const SLIM_MEDICINE_KEYS = [
  "id",
  "name",
  "unit",
  "brand",
  "generic_name",
  "strength",
  "dosage_form",
  "manufacturer",
  "pack_size",
  "sku",
  "selling_price",
] as const;

export type SlimMedicineKey = (typeof SLIM_MEDICINE_KEYS)[number];

/** The only medicine shape the new routes return. */
export interface SlimMedicine {
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
  /** Decimal string with two places, or null. Only used to show "No selling price" and the current price. */
  selling_price: string | null;
}

export interface MedicinePage {
  items: SlimMedicine[];
  next_cursor: string | null;
}

export interface UsualMedicine {
  medicine: SlimMedicine;
  /** How many of the store's recent qualifying orders contain this medicine (once per order). */
  order_count: number;
  last_ordered_at: string;
  last_quantity: number;
  last_unit: string;
}

export interface RepeatSource {
  order_id: string;
  order_number: number;
  confirmed_at: string;
  line_count: number;
}

export interface UsualResponse {
  usual: UsualMedicine[];
  source: RepeatSource | null;
}

export type RepeatLine =
  | { kind: "catalog"; medicine: SlimMedicine; quantity: number; unit: string }
  | { kind: "typed"; name: string; quantity: number; unit: string };

export type SkippedReason = "inactive" | "missing" | "over_limit";

export interface SkippedLine {
  name: string;
  reason: SkippedReason;
}

export interface RepeatPlan {
  lines: RepeatLine[];
  skipped: SkippedLine[];
}

export const USUAL_MAX = 12;
export const USUAL_WINDOW_DAYS = 180;
export const USUAL_MAX_ORDERS = 100;
