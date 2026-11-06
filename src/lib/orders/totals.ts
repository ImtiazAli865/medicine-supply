import { parseMoneyToPaisa } from "@/lib/money";

// Exact PKR arithmetic for order lines. A line total can reach 100,000 x 9,999,999,999.99, which is
// beyond the safe integer range of a JavaScript number in paisa, so the products and sums use BigInt.

function formatPaisa(paisa: bigint): string {
  const whole = paisa / BigInt(100);
  const fraction = paisa % BigInt(100);
  return `${whole}.${String(fraction).padStart(2, "0")}`;
}

function linePaisa(quantity: number, sellingPrice: string | null | undefined): bigint | null {
  if (!Number.isInteger(quantity) || quantity < 1) return null;
  if (sellingPrice == null) return null;
  const paisa = parseMoneyToPaisa(sellingPrice);
  return paisa === null ? null : BigInt(paisa) * BigInt(quantity);
}

/** Quantity x selling price as a two-decimal string, or null when there is no usable price. */
export function lineTotal(quantity: number, sellingPrice: string | null | undefined): string | null {
  const paisa = linePaisa(quantity, sellingPrice);
  return paisa === null ? null : formatPaisa(paisa);
}

export interface PricedLine {
  quantity: number;
  selling_price: string | null | undefined;
}

export interface Totals {
  pricedTotal: string;
  pricedLines: number;
  unpricedLines: number;
  lineCount: number;
}

/** Sum of the lines that have a selling price. A line without one is counted, never added as zero silently. */
export function orderTotals(lines: PricedLine[]): Totals {
  let sum = BigInt(0);
  let priced = 0;
  for (const line of lines) {
    const paisa = linePaisa(line.quantity, line.selling_price);
    if (paisa === null) continue;
    sum += paisa;
    priced += 1;
  }
  return { pricedTotal: formatPaisa(sum), pricedLines: priced, unpricedLines: lines.length - priced, lineCount: lines.length };
}

/** The wording for a total: it says "of priced lines" and counts the unpriced lines whenever any exist. */
export function totalsLabel(totals: Totals): { heading: string; note: string | null; hasAnyPrice: boolean } {
  const n = totals.unpricedLines;
  return {
    heading: n > 0 ? "Total of priced lines" : "Total",
    note: n > 0 ? (n === 1 ? "1 line has no selling price" : `${n} lines have no selling price`) : null,
    hasAnyPrice: totals.pricedLines > 0,
  };
}
