import type { SlimMedicine } from "./fast-types";
import { effectivePrice, sameUnit, type PriceSource, type RateInfo, type StoreRateMap } from "./price";
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
  /** Module 012 (all optional: details kept on a phone before Module 012 have none). */
  price_source?: PriceSource | null;
  chosen_price?: string | null;
  catalog_price?: string | null;
  product_unit?: string | null;
  rate?: RateInfo | null;
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
      // The typed price of a draft line is part of what the screen edits and saves.
      ...(l.chosen_price != null ? { price: l.chosen_price } : {}),
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
    price_source: line.price_source ?? null,
    chosen_price: line.chosen_price ?? null,
    catalog_price: line.catalog_price,
    product_unit: line.product_unit,
    rate: line.rate ?? null,
  };
}

export function infoFromOrder(order: Order): Record<string, LineInfo> {
  return Object.fromEntries(order.lines.map((l) => [l.id, infoFromLine(l)]));
}

/** The fields of a medicine the order screen shows; both a full product and the slim shape of Module 008 have them. */
export type ProductInfoSource = Pick<SlimMedicine, "name" | "strength" | "dosage_form" | "pack_size" | "manufacturer" | "selling_price"> & { unit?: string };

/** Display info for a line the person just added from the catalog (the live price is shown as current). */
export function infoFromProduct(product: ProductInfoSource): LineInfo {
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
    catalog_price: product.selling_price,
    product_unit: product.unit,
  };
}

/** What the screen shows for one line's price, and where it comes from (Module 012). */
export interface ShownPrice {
  price: string | null;
  source: PriceSource | null;
  /** The order store's rate for this medicine (only for the medicine's own unit). */
  rate: RateInfo | null;
  /** True when the line uses the medicine's own unit, so its price can be remembered. */
  unitMatches: boolean;
  /** The medicine's unit when it is known. */
  productUnit: string | null;
  catalog: string | null;
}

/**
 * The price of one line as the screen shows it. A recorded (snapshot) price is shown as recorded. Otherwise the same
 * rule as the database applies, using the store's rates when they are loaded and the order's own details when not.
 */
export function shownPrice(line: OrderLineInput, info: LineInfo | undefined, rates: StoreRateMap | null): ShownPrice {
  const none: ShownPrice = { price: null, source: null, rate: null, unitMatches: false, productUnit: null, catalog: null };
  if (!info) return none;
  if (info.price_basis === "snapshot") return { ...none, price: info.selling_price, source: info.price_source ?? null };
  if (line.product_id === null) return none;
  const known = rates?.get(line.product_id);
  const productUnit = known?.unit ?? info.product_unit ?? null;
  const unitMatches = productUnit !== null && sameUnit(line.unit, productUnit);
  // Without the loaded rates, the rate the server sent with this order is used (it is only sent for a matching unit).
  const rate = rates ? (known && unitMatches ? known : null) : productUnit === null || unitMatches ? (info.rate ?? null) : null;
  const catalog = info.catalog_price !== undefined ? info.catalog_price : info.selling_price;
  const chosen = line.price !== undefined ? line.price : (info.chosen_price ?? null);
  const result = effectivePrice({
    typedLine: false,
    chosen,
    rate: rate?.rate,
    productActive: true,
    lineUnit: line.unit,
    productUnit: line.unit,
    catalog,
  });
  return { price: result.price, source: result.source, rate, unitMatches, productUnit, catalog: catalog ?? null };
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

/**
 * Adds several lines in one change (so one autosave sends one save). Lines beyond the 200-line limit and lines with an
 * invalid quantity are refused and counted, never added silently wrong. The line ids are made by the caller on the device.
 */
export function appendLines(state: EditorState, entries: OrderLineInput[]): { state: EditorState; added: OrderLineInput[]; refused: number } {
  const room = Math.max(0, LIMITS.lines - state.lines.length);
  const added: OrderLineInput[] = [];
  let refused = 0;
  for (const entry of entries) {
    if (added.length >= room || !isValidQuantity(entry.quantity)) {
      refused += 1;
      continue;
    }
    added.push(entry);
  }
  return { state: { ...state, lines: [...state.lines, ...added] }, added, refused };
}

/** Removes exactly the lines with these ids (an id that is not on the order is ignored). */
export function removeLinesById(state: EditorState, ids: readonly string[]): EditorState {
  const drop = new Set(ids);
  return { ...state, lines: state.lines.filter((l) => !drop.has(l.id)) };
}
