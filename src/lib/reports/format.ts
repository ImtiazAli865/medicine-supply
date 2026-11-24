import { formatPKR } from "@/lib/money";
import { profitText } from "./labels";
import type { ProfitFigure } from "./types";

// Small pure helpers for the report screens and the CSV, so both write the same words.

/** "500 mg · tablet · 10 · GSK": the identity of a medicine as it was frozen on the invoice line. Empty parts are left out. */
export function medicineDetails(m: { strength?: string | null; dosage_form?: string | null; pack_size?: string | null; manufacturer?: string | null }): string {
  return [m.strength, m.dosage_form, m.pack_size, m.manufacturer].filter((x): x is string => typeof x === "string" && x.trim() !== "").join(" · ");
}

/** "PKR 1,250.00 · Incomplete" style summary of one figure's profit for a list row. */
export function profitSummary(figure: ProfitFigure): string {
  const base = profitText(figure.profit);
  return figure.status === "incomplete" ? `${base} (incomplete)` : base;
}

/** Sales as money text (a missing amount is a dash). */
export function salesText(amount: string | null | undefined): string {
  return formatPKR(amount ?? null);
}
