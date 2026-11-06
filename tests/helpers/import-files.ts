import { zipSync, strToU8 } from "fflate";
import writeExcelFile from "write-excel-file/universal";
import { TEMPLATE_HEADINGS } from "../../src/lib/import/columns";
import type { FileLike } from "../../src/lib/import/inspect-file";

// Builds test files in memory (nothing binary is committed). Used by unit tests and Playwright.

export type SheetCell = string | number | null;

export function fileLike(name: string, bytes: Uint8Array | string): FileLike {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return {
    name,
    size: data.byteLength,
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
  };
}

export async function xlsxBytes(sheets: { name: string; rows: SheetCell[][] }[]): Promise<Uint8Array> {
  const blob = await writeExcelFile(
    sheets.map((s) => ({
      sheet: s.name,
      data: s.rows.map((row) =>
        row.map((value) => (typeof value === "number" ? { value, type: Number } : value === null ? null : { value })),
      ),
    })),
  ).toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}

export const HEADER_ROW: string[] = [...TEMPLATE_HEADINGS];

export const VALID_5_ROWS: string[][] = [
  ["Amoxil", "strip", "Amoxil", "Amoxicillin", "500 mg", "Capsule", "Sami", "10 caps", "", "40", "55", "60"],
  ["Brufen", "strip", "Brufen", "Ibuprofen", "400 mg", "Tablet", "Abbott", "10 tabs", "", "12", "18", "20"],
  ["Cetrin", "strip", "Cetrin", "Cetirizine", "10 mg", "Tablet", "GSK", "10 tabs", "", "", "", ""],
  ["Calpol", "bottle", "Calpol", "Paracetamol", "120 mg", "Syrup", "GSK", "60 ml", "", "50.50", "70", "80"],
  ["پیراسیٹامول", "strip", "", "Paracetamol", "500 mg", "Tablet", "Getz", "20 tabs", "", "", "", ""],
];

export const validXlsx = () =>
  xlsxBytes([{ name: "Medicines", rows: [HEADER_ROW, ...VALID_5_ROWS.map((r) => r.map((c) => (c === "" ? null : c)))] }]);

/** A real xlsx cut off in the middle: a damaged zip. */
export async function damagedXlsx(): Promise<Uint8Array> {
  const good = await validXlsx();
  return good.slice(0, Math.floor(good.length * 0.6));
}

/** What Excel produces for a password-protected workbook: an old-style OLE container. */
export function passwordProtectedXlsx(): Uint8Array {
  const bytes = new Uint8Array(2048);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return bytes;
}

/** A well-formed zip that contains a macro project. */
export function macroXlsx(): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Medicines" sheetId="1"/></sheets></workbook>'),
    "xl/vbaProject.bin": strToU8("macro"),
  });
}

/** A zip with more entries than allowed (zip-bomb style structure). */
export function manyEntriesXlsx(): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Medicines" sheetId="1"/></sheets></workbook>'),
  };
  for (let i = 0; i < 1100; i++) files[`xl/junk/${i}.xml`] = strToU8("x");
  return zipSync(files);
}

const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const toCsv = (rows: string[][]) => rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";

export const validCsv = () => toCsv([HEADER_ROW, ...VALID_5_ROWS]);

export function bulkRows(count: number, prefix = "Bulk"): string[][] {
  return Array.from({ length: count }, (_, i) => [
    `${prefix} ${i}`, "strip", "", "", `${i} mg`, "Tablet", "Maker", "10 tabs", "", "10.00", "12.00", "15.00",
  ]);
}

export const csv5000 = (prefix = "Bulk") => toCsv([HEADER_ROW, ...bulkRows(5000, prefix)]);
export const xlsx5000 = (prefix = "Bulk") =>
  xlsxBytes([{ name: "Medicines", rows: [HEADER_ROW, ...bulkRows(5000, prefix).map((r) => r.map((c) => (c === "" ? null : c)))] }]);

/** 10,001 data rows: over the row limit. */
export const tooManyRowsCsv = () => toCsv([HEADER_ROW, ...bulkRows(10001)]);

/** Within 5 MB and 10,000 rows, but over 4 MB of text once sent to the server. */
export function tooWideCsv(): string {
  const rows = Array.from({ length: 10000 }, (_, i) => {
    const long = `W${i} ` + "x".repeat(190);
    return [long, "strip", "y".repeat(190), "", `${i} mg`, "", "", "", "", "", "", ""];
  });
  return toCsv([HEADER_ROW, ...rows]);
}

/** More than 5 MB of text. */
export const tooLargeCsv = () => "name,unit\r\n" + "a".repeat(5 * 1024 * 1024 + 10);
