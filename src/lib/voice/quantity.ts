import { LIMITS } from "@/lib/orders/editor-state";
import type { LineFlag } from "./types";

// The quantity and unit rules of a voice line, in one place (pure functions; no I/O). They mirror the manual order
// limits: a quantity is a whole number from 1 to 100,000 and a unit is at most 50 characters. A doubtful value is
// FLAGGED and left for the supplier; it is never rounded, assumed or invented.

export interface QuantityResult {
  quantity: number | null;
  flags: LineFlag[];
}

/** A usable whole quantity, or null plus the reason it is doubtful. */
export function normaliseQuantity(raw: number | null | undefined): QuantityResult {
  if (raw === null || raw === undefined) return { quantity: null, flags: ["missing_quantity"] };
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw)) return { quantity: null, flags: ["quantity_not_whole"] };
  if (raw < 1) return { quantity: null, flags: ["quantity_too_small"] };
  if (raw > LIMITS.quantityMax) return { quantity: null, flags: ["quantity_too_large"] };
  return { quantity: raw, flags: [] };
}

export interface UnitResult {
  unit: string | null;
  flags: LineFlag[];
}

/**
 * Keeps the unit as spoken (extra spaces cleaned, at most 50 characters). When none was spoken the chosen medicine's
 * own unit is shown with the flag `unit_not_heard`; an unknown medicine with no unit stays empty (flagged) for the
 * supplier to fill in.
 */
export function normaliseUnit(raw: string | null | undefined, medicineUnit: string | null | undefined): UnitResult {
  const spoken = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, LIMITS.unit);
  if (spoken !== "") return { unit: spoken, flags: [] };
  const own = (medicineUnit ?? "").replace(/\s+/g, " ").trim().slice(0, LIMITS.unit);
  return { unit: own !== "" ? own : null, flags: ["unit_not_heard"] };
}

/** True when a typed quantity text is a usable whole quantity (used when the supplier edits a line). */
export function isUsableQuantity(value: number | null | undefined): value is number {
  return normaliseQuantity(value).quantity !== null;
}
