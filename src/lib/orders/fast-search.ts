import { searchTokens } from "@/lib/normalize";
import type { SlimMedicine } from "./fast-types";

// The matching rules of the fast order search (Module 008), pure code used on the device. They copy the server search:
// every word must be found in the search text (name, brand, generic name, strength, manufacturer, code) or in the
// dosage form, ignoring case and extra spaces. Digits are ordinary text: "panadol 500" narrows to the 500 strength.

export const MAX_RESULTS = 30;
export const MAX_WORDS = 8;

/** A medicine with its lower-case search text prepared once, so a keystroke only runs substring checks. */
export interface SearchRow {
  medicine: SlimMedicine;
  /** Same fields, in the same order, as the database column `products.search_text`. */
  text: string;
  dosage: string;
}

export function normalizeRow(medicine: SlimMedicine): SearchRow {
  const text = [medicine.name, medicine.brand, medicine.generic_name, medicine.strength, medicine.manufacturer, medicine.sku]
    .map((part) => part ?? "")
    .join(" ")
    .toLowerCase();
  return { medicine, text, dosage: (medicine.dosage_form ?? "").toLowerCase() };
}

export interface ParsedQuery {
  /** Lower-case words, at most eight; all of them must match. */
  words: string[];
}

export function parseQuery(text: string): ParsedQuery {
  return { words: searchTokens(text, MAX_WORDS) };
}

export interface FilterResult {
  results: SlimMedicine[];
  /** How many more medicines match than are shown ("keep typing"). */
  more: number;
}

/**
 * The medicines that match every word, with names that start with the first word first, then by name and id.
 * At most `max` are returned. No words means no results.
 */
export function filterMedicines(rows: readonly SearchRow[], words: readonly string[], max: number = MAX_RESULTS): FilterResult {
  if (words.length === 0) return { results: [], more: 0 };
  const first = words[0]!;
  const matched: Array<{ row: SearchRow; starts: boolean; name: string }> = [];
  for (const row of rows) {
    let ok = true;
    for (const word of words) {
      if (!row.text.includes(word) && !row.dosage.includes(word)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const name = row.medicine.name.toLowerCase();
    matched.push({ row, starts: name.startsWith(first), name });
  }
  matched.sort((a, b) => {
    if (a.starts !== b.starts) return a.starts ? -1 : 1;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.row.medicine.id < b.row.medicine.id ? -1 : a.row.medicine.id > b.row.medicine.id ? 1 : 0;
  });
  const results = matched.slice(0, max).map((m) => m.row.medicine);
  return { results, more: Math.max(0, matched.length - results.length) };
}

/**
 * The result Enter may choose without a tap: only when exactly one medicine is left. With several (different strengths,
 * forms, manufacturers or pack sizes) nothing is highlighted, so the supplier always chooses.
 */
export function highlightIndex(results: readonly SlimMedicine[], more: number = 0): number | null {
  return results.length === 1 && more === 0 ? 0 : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The "x" quantity (research D5). "pan x20" means quantity 20, but only when the whole text including "x20" matches no
// medicine as text, only as the LAST word of a text that has at least one other word, with no space inside "x20", and only
// 1 to 6 digits. It is applied only when the supplier chooses a result; it never chooses one.
// ---------------------------------------------------------------------------------------------------------------

export interface QuantityHint {
  /** The word as typed, for example "x20". */
  text: string;
  /** The quantity, or null when it is not a whole number from 1 to 100,000 (shown as an error, never ignored). */
  value: number | null;
}

const QUANTITY_MAX = 100000;

/** Reads a word like "x20" or "×20" as a quantity hint; null when the word is not of that form. */
export function readQuantityHint(word: string): QuantityHint | null {
  const match = /^[x\u00d7](\d{1,6})$/.exec(word.toLowerCase());
  if (!match) return null;
  const value = Number(match[1]);
  return { text: word, value: Number.isInteger(value) && value >= 1 && value <= QUANTITY_MAX ? value : null };
}

/** Splits "pan x20" into the search text "pan" and the hint "x20"; null when the last word is not a hint or is the only word. */
export function splitQuantityHint(text: string): { base: string; hint: QuantityHint } | null {
  const words = parseQuery(text).words;
  if (words.length < 2) return null;
  const hint = readQuantityHint(words[words.length - 1]!);
  return hint ? { base: words.slice(0, -1).join(" "), hint } : null;
}

export interface SearchOutcome extends FilterResult {
  /** The hint that was read from the text, or null when the whole text was searched as text. */
  hint: QuantityHint | null;
}

/**
 * Searches the device list. The whole text is searched first; only when it matches nothing and its last word is a quantity
 * hint, the text without that word is searched and the hint is returned.
 */
export function runSearch(rows: readonly SearchRow[], text: string, max: number = MAX_RESULTS): SearchOutcome {
  const words = parseQuery(text).words;
  const whole = filterMedicines(rows, words, max);
  if (whole.results.length === 0) {
    const split = splitQuantityHint(text);
    if (split) return { ...filterMedicines(rows, parseQuery(split.base).words, max), hint: split.hint };
  }
  return { ...whole, hint: null };
}
