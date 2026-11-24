import { formatPKR } from "@/lib/money";
import type { CostMissingReason, FigureStatus } from "./types";

// The one place for the wording of the Module 010 reports: what a figure is called, what it is made of, and what is
// said when a cost is missing. Screens, the CSV and the tests all read these, so the words cannot drift apart.

export type FigureKind = "estimated" | "realized";

export const NOT_AVAILABLE = "Not available";

export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function figureTitle(kind: FigureKind): string {
  return kind === "estimated" ? "Estimated profit" : "Realized profit";
}

/** "Estimate", "Estimate · Incomplete", "Realized" or "Realized · Incomplete". The badge never relies on colour alone. */
export function figureBadge(kind: FigureKind, status: FigureStatus): string {
  const base = kind === "estimated" ? "Estimate" : "Realized";
  return status === "incomplete" ? `${base} · Incomplete` : base;
}

export function figureExplanation(kind: FigureKind): string {
  return kind === "estimated"
    ? "Uses the purchase price saved on each order line when the order was confirmed. A planning figure, not a proven cost."
    : "Uses the actual cost you recorded when you bought the medicine on the day of the order. Nothing is borrowed from other days.";
}

/** A profit as money, or "Not available" when no line had a cost. */
export function profitText(profit: string | null): string {
  return profit === null ? NOT_AVAILABLE : formatPKR(profit);
}

/** "3 lines (PKR 12,500.00 of sales) have no cost", or an empty text when nothing is missing. */
export function missingSentence(lines: number, sales: string): string {
  if (lines <= 0) return "";
  const noun = plural(lines, "line", "lines");
  const verb = plural(lines, "has", "have");
  return `${lines} ${noun} (${formatPKR(sales)} of sales) ${verb} no cost`;
}

/** What was left out of the sales, or an empty text when nothing was. */
export function excludedSentence(cancelled: number, drafts: number): string {
  const parts: string[] = [];
  if (cancelled > 0) parts.push(`${cancelled} cancelled ${plural(cancelled, "invoice", "invoices")}`);
  if (drafts > 0) parts.push(`${drafts} draft ${plural(drafts, "invoice", "invoices")}`);
  if (parts.length === 0) return "";
  return `${parts.join(" and ")} ${plural(cancelled + drafts, "is", "are")} not counted.`;
}

export function reasonText(reason: CostMissingReason): string {
  switch (reason) {
    case "no_purchase_price_saved":
      return "No purchase price was saved on the order line.";
    case "no_purchase_on_market_day":
      return "No purchase with a cost was recorded on the day of the order.";
    case "typed_line":
      return "This medicine is not registered, so no cost can be found.";
    case "unit_differs":
      return "A purchase with a cost exists that day, but in a different unit.";
  }
}

export function purchaseNoCostSentence(entries: number, quantity: number): string {
  if (entries <= 0) return "";
  return `${entries} purchase ${plural(entries, "entry has", "entries have")} no cost recorded (${quantity} ${plural(quantity, "unit", "units")}). They are not in the money total.`;
}

export function cancelledEntriesSentence(count: number): string {
  if (count <= 0) return "";
  return `${count} cancelled purchase ${plural(count, "entry is", "entries are")} left out.`;
}

export const ROUNDING_NOTE = "Rows are rounded one by one, so cost and profit rows can differ from the total by a paisa or two.";
export const SERIES_NOTE = "Days without sales are not listed.";
export const OFFLINE_MESSAGE = "Reports need the internet. Connect and try again.";
export const INTERNAL_NOTE = "Reports are for you only. They never appear on invoices, statements, prints or backups.";

/** The status column of the CSV for one figure: "Estimate", "Realized, incomplete: 3 lines without cost" or "Not available". */
export function figureStatusText(kind: FigureKind, figure: { profit: string | null; status: FigureStatus; missing_lines: number }): string {
  const base = kind === "estimated" ? "Estimate" : "Realized";
  if (figure.profit === null) return `${base}: not available (no line has a cost)`;
  if (figure.status === "incomplete") return `${base}, incomplete: ${figure.missing_lines} ${plural(figure.missing_lines, "line", "lines")} without cost`;
  return base;
}
