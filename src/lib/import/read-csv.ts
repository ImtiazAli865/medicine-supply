import { rowsFromTable, type TableResult } from "./table";
import { ImportFileError } from "./types";

/**
 * Reads CSV bytes (browser side). UTF-8 only, with or without a byte-order mark; comma-separated.
 * Papa Parse is loaded on demand so the rest of the app does not pay for it.
 */
export async function readCsv(bytes: Uint8Array): Promise<TableResult> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ImportFileError(
      "bad_encoding",
      "This file is not saved as UTF-8, so some letters would be wrong. In Excel use Save As > CSV UTF-8, or use the .xlsx format instead.",
    );
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const Papa = (await import("papaparse")).default;
  const parsed = Papa.parse<string[]>(text, { delimiter: ",", skipEmptyLines: false });

  if (parsed.errors.some((e) => e.type === "Quotes")) {
    throw new ImportFileError("damaged", "A quotation mark in this CSV is never closed, so the rows cannot be read safely. Fix the file and try again.");
  }

  const table = parsed.data;
  // Rows are counted by file row (the heading row is 1). Blank rows stay in so numbers match the file.
  const first = table[0] ?? [];
  if (first.length === 1 && /[;\t]/.test(first[0] ?? "")) {
    throw new ImportFileError(
      "wrong_delimiter",
      "This file separates columns with semicolons or tabs. Save it as a comma-separated CSV (CSV UTF-8) or use the .xlsx format.",
    );
  }

  return rowsFromTable(table);
}
