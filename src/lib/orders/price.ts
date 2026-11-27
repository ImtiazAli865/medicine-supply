// The one rule for the price of a draft line (Module 012). It mirrors the database function
// order_line_effective_price, and both are tested with the same cases (tests/fixtures/effective-price-cases.json):
// the price typed on this order, else the order store's rate for the medicine (only for the medicine's own unit),
// else the medicine's catalog selling price, else none. No price is ever computed from another one.

import { canonicalMoney, parseMoneyToPaisa } from "@/lib/money";

export type PriceSource = "typed" | "store_rate" | "catalog";

/** A store's remembered rate for one medicine, as the screen and the phone keep it. */
export interface RateInfo {
  rate: string;
  version: number;
  /** The catalog price when the rate was saved. */
  catalog_price_at_set: string | null;
}

/** A store's rate with the medicine's own unit, keyed by medicine id. */
export interface StoreRateView extends RateInfo {
  unit: string;
}

export type StoreRateMap = ReadonlyMap<string, StoreRateView>;

export interface PriceInput {
  /** True for a typed (not registered) line. */
  typedLine: boolean;
  chosen: string | null | undefined;
  rate: string | null | undefined;
  productActive: boolean;
  lineUnit: string;
  productUnit: string | null | undefined;
  catalog: string | null | undefined;
}

export interface EffectivePrice {
  price: string | null;
  source: PriceSource | null;
}

/** The same text comparison the database uses for units. */
export function sameUnit(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return norm(a) === norm(b);
}

export function effectivePrice(input: PriceInput): EffectivePrice {
  if (input.typedLine) return { price: null, source: null };
  if (input.chosen != null) return { price: input.chosen, source: "typed" };
  if (input.rate != null && input.productActive && sameUnit(input.lineUnit, input.productUnit)) return { price: input.rate, source: "store_rate" };
  if (input.catalog != null) return { price: input.catalog, source: "catalog" };
  return { price: null, source: null };
}

export const PRICE_MESSAGE = "Enter a price above 0 with at most two decimals.";

/** The canonical two-decimal price a person typed, or null when it is not above zero with at most two decimals. */
export function parsePriceInput(text: string): string | null {
  const paisa = parseMoneyToPaisa(text);
  return paisa === null || paisa <= 0 ? null : canonicalMoney(text.trim());
}

/** True when a typed price differs from the catalog price by more than half: a likely typing mistake worth a question. */
export function needsPriceConfirmation(price: string, catalog: string | null | undefined): boolean {
  const typed = parseMoneyToPaisa(price);
  const base = catalog == null ? null : parseMoneyToPaisa(catalog);
  if (typed === null || base === null || base <= 0) return false;
  return Math.abs(typed - base) * 2 > base;
}

/** True when the catalog price is no longer what it was when the store's rate was saved. */
export function catalogMoved(rate: RateInfo | null | undefined, catalog: string | null | undefined): boolean {
  if (!rate) return false;
  const norm = (v: string | null | undefined) => (v == null ? null : parseMoneyToPaisa(v));
  return norm(rate.catalog_price_at_set) !== norm(catalog);
}
