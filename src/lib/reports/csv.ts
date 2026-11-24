import { balanceKind } from "@/lib/accounts/status";
import type { AccountRow, AccountsSummary } from "@/lib/accounts/types";
import { csvCell } from "@/lib/market/csv";
import { excludedSentence, figureStatusText, plural, type FigureKind } from "./labels";
import type { CostMissingReport, CostMissingRow, ListTotals, MedicineReport, MedicineRow, NotInAccount, ProfitFigure, PurchaseReport, SalesReport, StoreReport } from "./types";

// CSV of the Module 010 reports. Free text goes through csvCell (a cell that starts like a spreadsheet formula gets a
// leading apostrophe). Numbers go through csvNumber, which writes them as they are: csvCell would turn the negative
// number -12.50 into the text '-12.50, and a loss must stay a number.
//
// Each file holds exactly what its screen shows for the same period and filters (there is no PDF). A figure's status
// keeps the Estimate, Incomplete and "not available" markers, and every file ends with a TOTAL row.

const NUMBER = /^-?\d+(\.\d+)?$/;

/** A money amount or a count written as it is. A value that is not a plain number is a programming error. */
export function csvNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const text = typeof value === "number" ? String(value) : value;
  if (!NUMBER.test(text)) throw new Error(`csvNumber needs a plain number, got: ${text}`);
  return text;
}

/** Text cell: the shared market-list rule. */
export function csvText(value: string | null | undefined): string {
  return csvCell(value ?? "");
}

/** The whole file: header line, then the rows, every line ending in CRLF. */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header.map((h) => csvText(h)).join(","), ...rows.map((r) => r.join(","))].join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------------------------------
// The six reports
// ---------------------------------------------------------------------------------------------------

const figureHeader = (kind: "Estimated" | "Realized") => [`${kind} cost`, `${kind} profit`, `${kind} status`, `${kind} lines without cost`];

function figureCells(kind: FigureKind, figure: ProfitFigure): string[] {
  return [csvNumber(figure.cost), csvNumber(figure.profit), csvText(figureStatusText(kind, figure)), csvNumber(figure.missing_lines)];
}

function periodText(period: { from: string; to: string }): string {
  return csvText(`${period.from} to ${period.to}`);
}

const yesNo = (value: boolean) => (value ? "Yes" : "No");

export function salesCsv(report: SalesReport): string {
  const period = periodText(report.period);
  const header = ["Period", "Bucket start", "Bucket end", "Partial bucket", "Sales", "Invoices", ...figureHeader("Estimated"), ...figureHeader("Realized"), "Note"];
  const rows = report.series.map((b) => [
    period, csvText(b.bucket_start), csvText(b.bucket_end), csvText(yesNo(b.partial)), csvNumber(b.sales), csvNumber(b.invoices),
    ...figureCells("estimated", b.estimated), ...figureCells("realized", b.realized), "",
  ]);
  rows.push([
    period, csvText("TOTAL"), "", "", csvNumber(report.totals.sales), csvNumber(report.totals.invoices),
    ...figureCells("estimated", report.estimated), ...figureCells("realized", report.realized),
    csvText(excludedSentence(report.excluded.cancelled_invoices, report.excluded.draft_invoices)),
  ]);
  return toCsv(header, rows);
}

export function purchasesCsv(report: PurchaseReport): string {
  const period = periodText(report.period);
  const header = ["Period", "Bucket start", "Bucket end", "Partial bucket", "Cost", "Entries", "Entries without cost", "Status", "Note"];
  const rows = report.series.map((b) => [
    period, csvText(b.bucket_start), csvText(b.bucket_end), csvText(yesNo(b.partial)), csvNumber(b.cost), csvNumber(b.entries), csvNumber(b.entries_without_cost),
    csvText(b.entries_without_cost > 0 ? "Incomplete" : "Complete"), "",
  ]);
  const t = report.totals;
  rows.push([
    period, csvText("TOTAL"), "", "", csvNumber(t.cost), csvNumber(t.entries), csvNumber(t.entries_without_cost),
    csvText(t.status === "incomplete" ? "Incomplete" : "Complete"),
    csvText(`${t.cancelled_entries_left_out} cancelled ${plural(t.cancelled_entries_left_out, "entry is", "entries are")} left out; ${t.quantity_without_cost} units have no cost recorded`),
  ]);
  return toCsv(header, rows);
}

function storeTotalRow(period: string, label: string, totals: ListTotals): string[] {
  return [period, csvText(label), csvNumber(totals.sales), csvNumber(totals.invoices), "", ...figureCells("estimated", totals.estimated), ...figureCells("realized", totals.realized), ""];
}

export function storesCsv(report: StoreReport): string {
  const period = periodText(report.period);
  const header = ["Period", "Store", "Sales", "Invoices", "Share of sales (%)", ...figureHeader("Estimated"), ...figureHeader("Realized"), "Note"];
  const rows = report.items.map((r) => [
    period, csvText(r.name), csvNumber(r.sales), csvNumber(r.invoices), csvNumber(r.share), ...figureCells("estimated", r.estimated), ...figureCells("realized", r.realized), "",
  ]);
  const whole = report.filtered_totals.sales === report.totals.sales && report.filtered_totals.invoices === report.totals.invoices;
  rows.push(storeTotalRow(period, whole ? "TOTAL" : "TOTAL (rows in this file)", report.filtered_totals));
  if (!whole) rows.push(storeTotalRow(period, "TOTAL (whole period)", report.totals));
  return toCsv(header, rows);
}

function medicineRow(period: string, r: MedicineRow, registered: boolean): string[] {
  return [
    period, csvText(r.name), csvText(r.strength), csvText(r.dosage_form), csvText(r.pack_size), csvText(r.manufacturer), csvText(r.unit),
    csvText(registered ? "Registered" : "Not registered"), csvNumber(r.billed_quantity), csvNumber(r.sales),
    ...figureCells("estimated", r.estimated), ...figureCells("realized", r.realized), "",
  ];
}

function medicineTotalRow(period: string, label: string, totals: ListTotals): string[] {
  return [period, csvText(label), "", "", "", "", "", "", "", csvNumber(totals.sales), ...figureCells("estimated", totals.estimated), ...figureCells("realized", totals.realized), ""];
}

export function medicinesCsv(report: MedicineReport): string {
  const period = periodText(report.period);
  const header = [
    "Period", "Medicine", "Strength", "Dosage form", "Pack size", "Manufacturer", "Unit", "Registered", "Billed quantity", "Sales",
    ...figureHeader("Estimated"), ...figureHeader("Realized"), "Note",
  ];
  const rows = [...report.items.map((r) => medicineRow(period, r, true)), ...report.typed_rows.map((r) => medicineRow(period, r, false))];
  const whole = report.filtered_totals.sales === report.totals.sales && report.filtered_totals.invoices === report.totals.invoices;
  rows.push(medicineTotalRow(period, whole ? "TOTAL" : "TOTAL (rows in this file)", report.filtered_totals));
  if (!whole) rows.push(medicineTotalRow(period, "TOTAL (whole period)", report.totals));
  return toCsv(header, rows);
}

function costMissingRow(period: string, r: CostMissingRow): string[] {
  return [
    period, csvText(r.name), csvText(r.strength), csvText(r.dosage_form), csvText(r.pack_size), csvText(r.manufacturer), csvText(r.unit),
    csvText(r.product_id === null ? "Not registered" : "Registered"), csvNumber(r.sales_amount), csvNumber(r.billed_quantity), csvNumber(r.lines),
    csvText(yesNo(r.estimate_missing)), csvText(yesNo(r.realized_missing)), csvText(r.realized_dates.join("; ")), csvText(r.reason),
  ];
}

export function costMissingCsv(report: CostMissingReport): string {
  const period = periodText(report.period);
  const header = [
    "Period", "Medicine", "Strength", "Dosage form", "Pack size", "Manufacturer", "Unit", "Registered", "Sales amount", "Billed quantity", "Lines",
    "Estimate missing", "Realized missing", "Market days without a purchase cost", "Reason",
  ];
  const rows = report.items.map((r) => costMissingRow(period, r));
  rows.push([period, csvText("TOTAL"), "", "", "", "", "", "", "", "", "", "", "", "", csvText(`${report.total} ${plural(report.total, "medicine", "medicines")}`)]);
  return toCsv(header, rows);
}

/** Outstanding balances: one row per store with its signed balance (negative is an advance), then the totals. */
export function balancesCsv(date: string, rows: readonly AccountRow[], summary: AccountsSummary, note: NotInAccount): string {
  const header = ["As on", "Store", "Balance", "Status", "Entries", "Last entry date", "Store is active", "Note"];
  const statusText = (balance: string) => {
    const kind = balanceKind(balance);
    return kind === "owes" ? "Owes" : kind === "advance" ? "Advance" : "Settled";
  };
  const out = rows.map((r) => [
    csvText(date), csvText(r.name), csvNumber(r.balance), csvText(statusText(r.balance)), csvNumber(r.entry_count), csvText(r.last_entry_date ?? ""), csvText(yesNo(r.is_active)), "",
  ]);
  const legacy = note.invoices > 0 ? `${note.invoices} ${plural(note.invoices, "invoice", "invoices")} issued before store accounts existed (${note.total}) ${plural(note.invoices, "is", "are")} not in any balance` : "";
  out.push([csvText(date), csvText("TOTAL OWED"), csvNumber(summary.total_owed), csvText("Owes"), "", "", "", csvText(legacy)]);
  out.push([csvText(date), csvText("TOTAL ADVANCE (not taken off the total owed)"), csvNumber(summary.total_advance), csvText("Advance"), "", "", "", ""]);
  return toCsv(header, out);
}
