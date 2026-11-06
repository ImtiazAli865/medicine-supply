import { rowsFromTable, type Cell, type TableResult } from "./table";
import { ImportFileError } from "./types";

/**
 * Reads the FIRST sheet of an .xlsx file (browser side). Numbers are kept as their exact text
 * (99.99 stays "99.99"); formula cells use the value Excel stored. The library is loaded on demand.
 */
export async function readXlsx(bytes: Uint8Array): Promise<TableResult> {
  const { readSheet } = await import("read-excel-file/universal");
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  let data: Cell[][];
  try {
    data = (await readSheet(buffer, 1, { parseNumber: (text: string) => text, trim: true })) as Cell[][];
  } catch {
    throw new ImportFileError("damaged", "This Excel file could not be read. Open it in Excel and save it again as .xlsx.");
  }
  return rowsFromTable(data);
}
