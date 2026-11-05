import { compareMoney, canonicalMoney, isValidMoney } from "@/lib/money";
import { cleanText, COLUMNS } from "./columns";
import type { ImportField, PriceWarning, RawRow, ValidRow } from "./types";

export interface InvalidRow {
  row_no: number;
  field: ImportField;
  message: string;
}

export type RowValidation =
  | { ok: true; row: ValidRow; warnings: PriceWarning[] }
  | { ok: false; invalid: InvalidRow };

const MONEY_HINT = "Use digits with an optional decimal point, like 1250 or 1250.50 (no currency symbol, letters or commas).";

function moneyProblem(text: string): string | null {
  if (isValidMoney(text)) return null;
  if (text.startsWith("-")) return "A price cannot be negative.";
  if (/^\d+\.\d{3,}$/.test(text)) return "A price can have at most two decimals; it is never rounded.";
  if (/^\d{11,}(\.\d*)?$/.test(text)) return "This price is too large.";
  return MONEY_HINT;
}

/**
 * Field validation of one row (pure, no catalog access). Runs in the browser for a quick preview AND on
 * the server for every request, because the browser is never trusted. Never fills a default: an empty
 * cell stays null. Only the first problem of a row is reported (columns are checked left to right).
 */
export function validateRow(raw: RawRow): RowValidation {
  const out: Record<string, string | null> = {};

  for (const col of COLUMNS) {
    const value = cleanText(raw[col.key]);

    if (value === null) {
      if (col.required) {
        return { ok: false, invalid: { row_no: raw.row_no, field: col.key, message: `${col.label} is required.` } };
      }
      out[col.key] = null;
      continue;
    }

    if (col.money) {
      const problem = moneyProblem(value);
      if (problem) return { ok: false, invalid: { row_no: raw.row_no, field: col.key, message: problem } };
      out[col.key] = canonicalMoney(value);
      continue;
    }

    if (col.max !== undefined && value.length > col.max) {
      return {
        ok: false,
        invalid: {
          row_no: raw.row_no,
          field: col.key,
          message: `${col.label} can be at most ${col.max} characters (this one has ${value.length}).`,
        },
      };
    }
    out[col.key] = value;
  }

  const row = { row_no: raw.row_no, ...out } as ValidRow;
  const warnings: PriceWarning[] = [];
  if ((compareMoney(row.selling_price, row.purchase_price) ?? 0) < 0) warnings.push("selling_below_purchase");
  if ((compareMoney(row.mrp, row.selling_price) ?? 0) < 0) warnings.push("mrp_below_selling");
  return { ok: true, row, warnings };
}
