import { EXAMPLE_MARKER, TEMPLATE_HEADINGS } from "./columns";

// The template is generated here (not stored as a file), so its headings always come from the same
// constant the reader checks. Row 1 is exactly the headings; row 2 is a clearly marked example row
// that the reader ignores.

export const EXAMPLE_ROW: string[] = [
  EXAMPLE_MARKER,
  "strip",
  "Brand name",
  "Generic name",
  "500 mg",
  "Tablet",
  "Manufacturer",
  "10 tabs",
  "SKU-001",
  "40.00",
  "55.00",
  "60.00",
];

export const INSTRUCTIONS: string[] = [
  "How to fill the Medicines sheet",
  "name and unit are REQUIRED for every medicine. All other columns are optional; leave a cell empty if you do not know the value.",
  "Do not rename, remove or add columns. Column order does not matter.",
  "Prices: digits with an optional decimal point, at most two decimals, for example 1250 or 1250.50. No currency symbol, letters or commas.",
  "Strength, dosage form, pack size and manufacturer are kept exactly as you type them. They are never guessed from the name.",
  "Delete the example row (its name starts with EXAMPLE) or leave it: it is never imported.",
  "A medicine that already exists is skipped. The same name with a different strength, form, pack size or manufacturer is shown as Similar and is only created if you choose it.",
];

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV text with a byte-order mark (so Excel opens it as UTF-8) and CRLF line endings. */
export function templateCsv(): string {
  return `﻿${[TEMPLATE_HEADINGS, EXAMPLE_ROW].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** The .xlsx template: sheet "Medicines" (headings + example) and sheet "Instructions". */
export async function templateXlsx(): Promise<Blob> {
  const writeExcelFile = (await import("write-excel-file/universal")).default;
  const medicines = [
    TEMPLATE_HEADINGS.map((h) => ({ value: h, fontWeight: "bold" as const })),
    EXAMPLE_ROW.map((value) => ({ value })),
  ];
  const instructions = INSTRUCTIONS.map((value, i) => [i === 0 ? { value, fontWeight: "bold" as const } : { value }]);
  return writeExcelFile([
    { data: medicines, sheet: "Medicines" },
    { data: instructions, sheet: "Instructions" },
  ]).toBlob();
}
