import { strFromU8, unzipSync } from "fflate";
import { MAX_FILE_BYTES } from "./columns";
import { ImportFileError } from "./types";

// Browser-side safety checks that run BEFORE any parsing. A bad file can only ever affect the
// user's own tab, and nothing is sent to the server until it has been read and checked.

export interface FileLike {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface Inspection {
  kind: "csv" | "xlsx";
  bytes: Uint8Array;
  /** Name of the first sheet (xlsx only). */
  sheetName?: string;
}

const MAX_ZIP_ENTRIES = 1000;
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_WORKBOOK_XML_BYTES = 1024 * 1024;

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((b, i) => bytes[i] === b);
}

function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Checks type, size and (for .xlsx) the zip structure. Throws ImportFileError with a clear message. */
export async function inspectFile(file: FileLike): Promise<Inspection> {
  const lower = file.name.toLowerCase();
  const kind = lower.endsWith(".csv") ? "csv" : lower.endsWith(".xlsx") ? "xlsx" : null;

  if (!kind) {
    const hint = lower.endsWith(".xlsm")
      ? "Files with macros (.xlsm) are not accepted."
      : lower.endsWith(".xls")
        ? "Old Excel files (.xls) are not accepted. Open it in Excel and save as .xlsx or CSV."
        : "Choose a .csv or .xlsx file.";
    throw new ImportFileError("unsupported_type", `This file type is not supported. ${hint}`);
  }
  if (file.size === 0) {
    throw new ImportFileError("empty", "The file is empty. Add your medicines under the template headings and try again.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new ImportFileError("too_large", `This file is ${mb(file.size)}. The limit is ${mb(MAX_FILE_BYTES)}. Split it into smaller files.`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (kind === "csv") {
    if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]) || startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
      throw new ImportFileError("unsupported_type", "This file is not a text CSV file even though it is named .csv. Open it in Excel and save as CSV UTF-8, or use .xlsx.");
    }
    return { kind, bytes };
  }

  // .xlsx
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    throw new ImportFileError(
      "password_protected",
      "This Excel file is password-protected or in an old format. Remove the password (or save it again as .xlsx) and try again.",
    );
  }
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    throw new ImportFileError("damaged", "This file is damaged or is not a real .xlsx file. Open it in Excel and save it again.");
  }

  const names: string[] = [];
  let declaredTotal = 0;
  let workbook: Uint8Array | undefined;
  try {
    // The filter sees every entry of the zip directory WITHOUT inflating it; only the small
    // workbook.xml (to read the sheet name) is inflated.
    const files = unzipSync(bytes, {
      filter: (info) => {
        names.push(info.name);
        declaredTotal += info.originalSize;
        return info.name === "xl/workbook.xml" && info.originalSize <= MAX_WORKBOOK_XML_BYTES;
      },
    });
    workbook = files["xl/workbook.xml"];
  } catch {
    throw new ImportFileError("damaged", "This Excel file is damaged and could not be opened. Open it in Excel and save it again.");
  }

  if (names.includes("xl/vbaProject.bin")) {
    throw new ImportFileError("macros", "This Excel file contains macros, which are not accepted. Save a copy without macros as .xlsx and try again.");
  }
  if (names.length > MAX_ZIP_ENTRIES || declaredTotal > MAX_UNCOMPRESSED_BYTES) {
    throw new ImportFileError("too_large", "This Excel file is too complex to read safely. Save the list as CSV, or split it into smaller files.");
  }
  if (!names.includes("[Content_Types].xml") || !workbook) {
    throw new ImportFileError("damaged", "This file is not a valid Excel workbook. Open it in Excel and save it again.");
  }

  const match = /<sheet\b[^>]*\bname="([^"]*)"/.exec(strFromU8(workbook));
  return { kind, bytes, sheetName: match ? decodeXml(match[1]) : undefined };
}
