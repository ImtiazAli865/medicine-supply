import { IMPORT_FIELDS, ImportFileError, type ImportField } from "./types";

export const MAX_ROWS = 10_000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Limit of the JSON text sent to the server in one preview or import request. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface ColumnDef {
  key: ImportField;
  /** Exact template heading (lowercase). */
  heading: string;
  label: string;
  required: boolean;
  /** Maximum characters, for text columns. */
  max?: number;
  money?: boolean;
}

export const COLUMNS: readonly ColumnDef[] = [
  { key: "name", heading: "name", label: "Name", required: true, max: 200 },
  { key: "unit", heading: "unit", label: "Unit", required: true, max: 50 },
  { key: "brand", heading: "brand", label: "Brand", required: false, max: 200 },
  { key: "generic_name", heading: "generic name", label: "Generic name", required: false, max: 200 },
  { key: "strength", heading: "strength", label: "Strength", required: false, max: 100 },
  { key: "dosage_form", heading: "dosage form", label: "Dosage form", required: false, max: 100 },
  { key: "manufacturer", heading: "manufacturer", label: "Manufacturer", required: false, max: 200 },
  { key: "pack_size", heading: "pack size", label: "Pack size", required: false, max: 100 },
  { key: "sku", heading: "sku", label: "SKU", required: false, max: 100 },
  { key: "purchase_price", heading: "purchase price", label: "Purchase price", required: false, money: true },
  { key: "selling_price", heading: "selling price", label: "Selling price", required: false, money: true },
  { key: "mrp", heading: "mrp", label: "MRP", required: false, money: true },
];

if (COLUMNS.length !== IMPORT_FIELDS.length) throw new Error("COLUMNS must cover every import field");

export const COLUMN_BY_KEY = Object.fromEntries(COLUMNS.map((c) => [c.key, c])) as Record<ImportField, ColumnDef>;

export const TEMPLATE_HEADINGS: string[] = COLUMNS.map((c) => c.heading);

/** The name cell of the template's example row. Rows whose name starts like this are never imported. */
export const EXAMPLE_MARKER = "EXAMPLE - delete this row";
const EXAMPLE_PATTERN = /^example\s*[-–—]\s*delete this row/i;

export function isExampleName(name: string | null | undefined): boolean {
  return name != null && EXAMPLE_PATTERN.test(name.trim());
}

/** Trims, collapses repeated whitespace (same idea as the database's norm_text, but keeps the case). */
export function cleanText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

function normalizeHeading(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export interface HeaderMatch {
  /** For every column of the file: the field it holds, or null when the heading is blank. */
  fields: (ImportField | null)[];
}

/**
 * Matches the first row of a file to the template columns: case and spacing are ignored, the order is
 * free. A missing required column, an unrecognised heading or a repeated heading rejects the whole file,
 * because ignoring a column could silently drop data the supplier thinks was imported.
 * Blank headings are returned as null; the caller rejects them only if the column holds data.
 */
export function matchHeaders(headings: (string | null | undefined)[]): HeaderMatch {
  const normalized = headings.map(normalizeHeading);
  const known = new Map(COLUMNS.map((c) => [c.heading, c.key] as const));
  const unknown: string[] = [];
  const repeated: string[] = [];
  const seen = new Set<string>();
  const fields: (ImportField | null)[] = [];

  normalized.forEach((heading, i) => {
    if (heading === "") {
      fields.push(null);
      return;
    }
    const key = known.get(heading);
    if (!key) {
      unknown.push((headings[i] ?? "").toString().trim());
      fields.push(null);
      return;
    }
    if (seen.has(heading)) {
      if (!repeated.includes(heading)) repeated.push(heading);
    }
    seen.add(heading);
    fields.push(key);
  });

  const missing = COLUMNS.filter((c) => c.required && !seen.has(c.heading)).map((c) => c.heading);

  if (unknown.length > 0 || repeated.length > 0 || missing.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);
    if (unknown.length > 0) parts.push(`Column${unknown.length > 1 ? "s" : ""} not in the template: ${unknown.join(", ")}.`);
    if (repeated.length > 0) parts.push(`Repeated column${repeated.length > 1 ? "s" : ""}: ${repeated.join(", ")}.`);
    throw new ImportFileError(
      "bad_headings",
      `The column headings do not match the template. ${parts.join(" ")} Rename or remove these columns, or download the template.`,
      { found: normalized.filter((h) => h !== ""), expected: [...TEMPLATE_HEADINGS] },
    );
  }

  return { fields };
}

/** Size in bytes of the JSON text a list of rows would take in a request. */
export function payloadBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
