import type { MarketRow, PurchaseStatus } from "./types";

// Wording and small helpers shared by the market list screens and their tests. No money anywhere in here.

const LABELS: Record<PurchaseStatus, string> = {
  not_bought: "Not bought",
  partly_bought: "Partly bought",
  fully_bought: "Fully bought",
  bought_extra: "Bought extra",
};

export function statusLabel(status: PurchaseStatus): string {
  return LABELS[status];
}

/** Only a fully bought row is green: a partial purchase and an extra purchase both ask for a look. */
export function statusTone(status: PurchaseStatus): "neutral" | "warning" | "success" | "danger" {
  switch (status) {
    case "fully_bought":
      return "success";
    case "partly_bought":
    case "bought_extra":
      return "warning";
    default:
      return "neutral";
  }
}

/** "20 of 45 strip bought, 25 remaining". Never a negative number. */
export function describeProgress(row: MarketRow): string {
  if (row.product_id === null) return `Not registered yet, ${row.total_requested} ${row.unit} to buy`;
  if (row.purchased === 0) return `Nothing bought yet, ${row.total_requested} ${row.unit} to buy`;
  const head = `${row.purchased} of ${row.total_requested} ${row.unit} bought`;
  if (row.extra > 0) return `${head}, ${row.extra} extra`;
  if (row.remaining > 0) return `${head}, ${row.remaining} remaining`;
  return head;
}

/** "500 mg · tablet · 10": the strength, dosage form and pack size that the medicine has. */
export function describeRow(row: MarketRow): string {
  return [row.strength, row.dosage_form, row.pack_size].filter((part): part is string => Boolean(part && part.trim())).join(" · ");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Nov 2026" for a YYYY-MM-DD day. */
export function formatDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return `${date} ${MONTHS[month - 1]} ${year}`;
}

/** The calendar day before or after a YYYY-MM-DD day. */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
