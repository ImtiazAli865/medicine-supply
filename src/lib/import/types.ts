// Types shared by the browser (file reading, preview screen) and the server (validation, API).

export const IMPORT_FIELDS = [
  "name",
  "unit",
  "brand",
  "generic_name",
  "strength",
  "dosage_form",
  "manufacturer",
  "pack_size",
  "sku",
  "purchase_price",
  "selling_price",
  "mrp",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** One data row exactly as read from the file: trimmed text cells, empty cells are null. Never trusted. */
export type RawRow = { row_no: number } & Partial<Record<ImportField, string | null>>;

/** A row that passed field validation: cleaned text and canonical two-decimal prices. */
export type ValidRow = { row_no: number } & Record<ImportField, string | null>;

export type RowStatus = "new" | "exists" | "similar" | "file_duplicate" | "sku_used" | "invalid";

export type PriceWarning = "selling_below_purchase" | "mrp_below_selling";

export interface PreviewRow {
  row_no: number;
  status: RowStatus;
  /** For invalid rows: the column that is wrong. */
  field?: ImportField | null;
  /** Human-readable reason (invalid) or detail. */
  message?: string | null;
  conflict?: { id: string; name: string } | null;
  warnings?: PriceWarning[];
}

export type StatusCounts = Record<RowStatus, number>;

export interface PreviewResponse {
  fingerprint: string;
  total: number;
  counts: StatusCounts;
  rows: PreviewRow[];
}

export interface SkippedRow {
  row_no: number;
  status: RowStatus;
  message: string;
  conflict_name?: string | null;
}

export interface ImportSummary {
  id: string;
  file_name: string;
  file_kind: "csv" | "xlsx";
  submitted_rows: number;
  created_count: number;
  created_similar_count: number;
  skipped_count: number;
  status_counts: Partial<Record<RowStatus, number>>;
  skipped?: SkippedRow[];
  created_at: string;
}

export interface ApplyResponse {
  applied: boolean;
  replayed: boolean;
  import: ImportSummary;
}

/** A file-level problem found while reading a file in the browser. Nothing is sent or saved. */
export class ImportFileError extends Error {
  readonly code: ImportFileErrorCode;
  readonly found?: string[];
  readonly expected?: string[];

  constructor(code: ImportFileErrorCode, message: string, extra: { found?: string[]; expected?: string[] } = {}) {
    super(message);
    this.name = "ImportFileError";
    this.code = code;
    this.found = extra.found;
    this.expected = extra.expected;
  }
}

export type ImportFileErrorCode =
  | "unsupported_type"
  | "too_large"
  | "too_many_rows"
  | "too_wide"
  | "empty"
  | "no_rows"
  | "bad_headings"
  | "password_protected"
  | "macros"
  | "damaged"
  | "bad_encoding"
  | "wrong_delimiter";

/** Result of reading a file: the rows plus a few facts to show the user. */
export interface ReadResult {
  rows: RawRow[];
  fileKind: "csv" | "xlsx";
  /** Name of the sheet that was read (xlsx only). */
  sheetName?: string;
  /** True when the clearly marked example row of the template was found and ignored. */
  exampleIgnored: boolean;
}
