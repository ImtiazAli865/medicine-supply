import { inspectFile, type FileLike } from "./inspect-file";
import { readCsv } from "./read-csv";
import { readXlsx } from "./read-xlsx";
import type { ReadResult } from "./types";

/** Checks a chosen file and reads it into import rows. Throws ImportFileError with a clear message. */
export async function readImportFile(file: FileLike): Promise<ReadResult> {
  const inspected = await inspectFile(file);
  const table = inspected.kind === "csv" ? await readCsv(inspected.bytes) : await readXlsx(inspected.bytes);
  return {
    rows: table.rows,
    fileKind: inspected.kind,
    sheetName: inspected.sheetName,
    exampleIgnored: table.exampleIgnored,
  };
}
