import { statusLabel } from "./status";
import type { MarketList, MarketRow } from "./types";

// CSV export of the market list: one line per medicine and store. It never contains a cost or a price: the
// header has no such column and the rows come from the list, which has none.

export const CSV_HEADER = [
  "Medicine",
  "Strength",
  "Dosage form",
  "Pack size",
  "Unit",
  "Store",
  "Store quantity",
  "Total requested",
  "Purchased",
  "Remaining",
  "Status",
  "Registered",
] as const;

/** A spreadsheet would run a text cell that starts with one of these characters as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell. Text that starts like a formula gets a leading apostrophe; numbers are written as they are. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function rowLines(row: MarketRow): string[] {
  const registered = row.product_id !== null;
  const status = registered ? statusLabel(row.status) : statusLabel("not_bought");
  return row.stores.map((s) =>
    [
      csvCell(registered ? row.name : row.typed_name),
      csvCell(row.strength),
      csvCell(row.dosage_form),
      csvCell(row.pack_size),
      csvCell(row.unit),
      csvCell(s.store_name),
      csvCell(s.quantity),
      csvCell(row.total_requested),
      csvCell(row.purchased),
      csvCell(row.remaining),
      csvCell(status),
      registered ? "registered" : "unregistered",
    ].join(","),
  );
}

/** The whole list as a CSV text (UTF-8 byte order mark first so a spreadsheet reads the names correctly). */
export function toCsv(list: MarketList): string {
  const body = [...list.rows, ...list.typed_rows].flatMap(rowLines);
  return `﻿${[CSV_HEADER.join(","), ...body].join("\r\n")}\r\n`;
}
