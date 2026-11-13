import type { Product } from "@/lib/products/types";
import type { Order, OrderLine, OrderLineInput, OrderSaveInput, PriceBasis } from "./types";

// The state the order screen edits and autosaves, plus what the screen needs to display each line.
// Only EditorState is saved; LineInfo is display-only (names, details and the price shown).

export interface EditorState {
  storeId: string;
  notes: string;
  lines: OrderLineInput[];
}

export interface LineInfo {
  name: string;
  /** The text the supplier typed, kept after the line was linked to a medicine (Module 004); null otherwise. */
  typed_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  pack_size: string | null;
  manufacturer: string | null;
  /** The selling price shown: current (draft), recorded (snapshot) or none. */
  selling_price: string | null;
  price_basis: PriceBasis;
  /** True for a typed (not registered) line. */
  typed: boolean;
}

export const LIMITS = { quantityMax: 100000, lines: 200, notes: 1000, unit: 50, name: 200, reason: 500 } as const;

export function emptyState(storeId: string): EditorState {
  return { storeId, notes: "", lines: [] };
}

/** The editable state of an order as loaded from the server. */
export function stateFromOrder(order: Order): EditorState {
  return {
    storeId: order.store.id,
    notes: order.notes ?? "",
    lines: order.lines.map((l) => ({
      id: l.id,
      product_id: l.product_id,
      name: l.product_id === null ? l.name : null,
      quantity: l.quantity,
      unit: l.unit,
    })),
  };
}

export function infoFromLine(line: OrderLine): LineInfo {
  return {
    name: line.name,
    typed_name: line.typed_name ?? null,
    strength: line.strength,
    dosage_form: line.dosage_form,
    pack_size: line.pack_size,
    manufacturer: line.manufacturer,
    selling_price: line.selling_price,
    price_basis: line.price_basis,
    typed: line.product_id === null,
  };
}

export function infoFromOrder(order: Order): Record<string, LineInfo> {
  return Object.fromEntries(order.lines.map((l) => [l.id, infoFromLine(l)]));
}

/** Display info for a line the person just added from the catalog (the live price is shown as current). */
export function infoFromProduct(product: Product): LineInfo {
  return {
    name: product.name,
    typed_name: null,
    strength: product.strength,
    dosage_form: product.dosage_form,
    pack_size: product.pack_size,
    manufacturer: product.manufacturer,
    selling_price: product.selling_price,
    price_basis: product.selling_price === null ? "none" : "current",
    typed: false,
  };
}

export function infoForTyped(name: string): LineInfo {
  return { name, typed_name: null, strength: null, dosage_form: null, pack_size: null, manufacturer: null, selling_price: null, price_basis: "none", typed: true };
}

/** The body of a save request for the current state. */
export function toSaveInput(state: EditorState, requestId: string, expectedVersion: number | null): OrderSaveInput {
  const notes = state.notes.trim();
  return {
    request_id: requestId,
    expected_version: expectedVersion,
    store_id: state.storeId,
    notes: notes === "" ? null : notes,
    lines: state.lines,
  };
}

/** Same text cleaning the server applies to a typed name: leading, trailing and repeated spaces only. */
export function cleanTypedName(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function isValidQuantity(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= LIMITS.quantityMax;
}

/** Parses what a person typed in a quantity field; null when it is not a whole number from 1 to 100,000. */
export function parseQuantity(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return isValidQuantity(value) ? value : null;
}

/** Typed lines that repeat the same text (compared ignoring case and spacing, like the catalog rules). */
export function repeatedTypedLineIds(state: EditorState, info: Record<string, LineInfo>): Set<string> {
  const byName = new Map<string, string[]>();
  for (const line of state.lines) {
    if (line.product_id !== null) continue;
    const key = cleanTypedName(info[line.id]?.name ?? line.name ?? "").toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), line.id]);
  }
  const repeated = new Set<string>();
  for (const ids of byName.values()) if (ids.length > 1) for (const id of ids) repeated.add(id);
  return repeated;
}
