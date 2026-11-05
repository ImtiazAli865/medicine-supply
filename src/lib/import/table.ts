import { cleanText, isExampleName, matchHeaders, MAX_BODY_BYTES, MAX_ROWS, payloadBytes } from "./columns";
import { ImportFileError, type ImportField, type RawRow } from "./types";

export type Cell = string | number | boolean | Date | null | undefined;

/** Text of one cell, whatever the reader produced. Numbers arrive as exact text (never rounded). */
export function cellText(cell: Cell): string | null {
  if (cell == null) return null;
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? null : cell.toISOString().slice(0, 10);
  if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
  return String(cell);
}

export interface TableResult {
  rows: RawRow[];
  exampleIgnored: boolean;
}

/**
 * Turns the cells of a file (first row = headings) into import rows. The same rules apply to CSV and
 * Excel: blank rows are skipped (row numbers still match the file, the heading row is row 1), the
 * template's example row is ignored, and the file is refused when it has no medicines, too many
 * rows, or too much text to send.
 */
export function rowsFromTable(table: Cell[][]): TableResult {
  if (table.length === 0 || table.every((r) => r.every((c) => cleanText(cellText(c)) === null))) {
    throw new ImportFileError("empty", "The file is empty. Add your medicines under the template headings and try again.");
  }

  const headingRow = table[0];
  if (headingRow.every((c) => cleanText(cellText(c)) === null)) {
    throw new ImportFileError("bad_headings", "The first row must contain the column headings. Download the template to see them.");
  }
  const { fields } = matchHeaders(headingRow.map(cellText));

  const rows: RawRow[] = [];
  let exampleIgnored = false;

  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    const row: RawRow = { row_no: i + 1 };
    let any = false;

    for (let col = 0; col < cells.length; col++) {
      const text = cleanText(cellText(cells[col]));
      if (text === null) continue;
      const field: ImportField | null = fields[col] ?? null;
      if (field === null) {
        // Data under a blank heading would be lost silently, so refuse the file.
        throw new ImportFileError(
          "bad_headings",
          `Row ${i + 1} has a value in a column with no heading. Add the heading from the template or delete that column.`,
        );
      }
      row[field] = text;
      any = true;
    }

    if (!any) continue; // blank row
    if (isExampleName(row.name)) {
      exampleIgnored = true;
      continue;
    }
    rows.push(row);
    if (rows.length > MAX_ROWS) {
      throw new ImportFileError(
        "too_many_rows",
        `This file has more than ${MAX_ROWS.toLocaleString("en-US")} medicines. Split it into smaller files and import them one by one.`,
      );
    }
  }

  if (rows.length === 0) {
    throw new ImportFileError(
      "no_rows",
      exampleIgnored
        ? "No medicines found in this file: only the example row is there. Replace it with your medicines."
        : "No medicines found in this file. Add rows under the headings and try again.",
    );
  }

  if (payloadBytes({ rows }) > MAX_BODY_BYTES) {
    throw new ImportFileError(
      "too_wide",
      "This file has too much text to send at once. Split it into two files and import them one by one. Nothing was sent or saved.",
    );
  }

  return { rows, exampleIgnored };
}
