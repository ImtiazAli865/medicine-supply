import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { ApiError, noBusiness } from "@/lib/api/errors";
import { validateRow, type InvalidRow } from "@/lib/import/validate-row";
import type {
  ApplyResponse,
  ImportSummary,
  PreviewResponse,
  PreviewRow,
  PriceWarning,
  RawRow,
  RowStatus,
  StatusCounts,
  ValidRow,
} from "@/lib/import/types";
import type { ApplyRequest } from "@/lib/validation/import";

// All catalog-dependent decisions are made by the database functions import_preview and
// import_apply (one classification, shared). This module only validates fields (the same pure
// function the browser uses, because the browser is never trusted) and shapes the results.

const SUMMARY_COLUMNS =
  "id,file_name,file_kind,submitted_rows,created_count,created_similar_count,skipped_count,status_counts,created_at";
const DETAIL_COLUMNS = `${SUMMARY_COLUMNS},skipped`;

interface Validated {
  valid: ValidRow[];
  invalid: InvalidRow[];
  warnings: Map<number, PriceWarning[]>;
}

function validateAll(rows: RawRow[]): Validated {
  const valid: ValidRow[] = [];
  const invalid: InvalidRow[] = [];
  const warnings = new Map<number, PriceWarning[]>();
  for (const raw of rows) {
    const result = validateRow(raw);
    if (result.ok) {
      valid.push(result.row);
      if (result.warnings.length > 0) warnings.set(raw.row_no, result.warnings);
    } else {
      invalid.push(result.invalid);
    }
  }
  return { valid, invalid, warnings };
}

function emptyCounts(): StatusCounts {
  return { new: 0, exists: 0, similar: 0, file_duplicate: 0, sku_used: 0, invalid: 0 };
}

function mapDatabaseError(error: PostgrestError): never {
  if (error.message?.includes("no_business")) throw noBusiness();
  // A concurrent writer won a unique index: the catalog changed under us, nothing was imported.
  if (error.code === "23505") {
    throw new ApiError("import_changed", "The medicine list changed while importing. Nothing was imported; please review the new preview.");
  }
  throw error;
}

export async function previewImport(supabase: SupabaseClient, rows: RawRow[]): Promise<PreviewResponse> {
  const { valid, invalid, warnings } = validateAll(rows);

  let fingerprint = "no-valid-rows";
  const classified = new Map<number, { status: RowStatus; conflict_product_id: string | null; conflict_name: string | null }>();

  if (valid.length > 0) {
    const { data, error } = await supabase.rpc("import_preview", { p_rows: valid });
    if (error) mapDatabaseError(error);
    const body = data as { fingerprint: string; rows: { row_no: number; status: RowStatus; conflict_product_id: string | null; conflict_name: string | null }[] };
    fingerprint = body.fingerprint;
    for (const r of body.rows) classified.set(r.row_no, r);
  }

  const counts = emptyCounts();
  const out: PreviewRow[] = [];

  for (const v of valid) {
    const c = classified.get(v.row_no);
    if (!c) throw new Error("import_preview did not classify every row");
    counts[c.status] += 1;
    out.push({
      row_no: v.row_no,
      status: c.status,
      conflict: c.conflict_product_id ? { id: c.conflict_product_id, name: c.conflict_name ?? "" } : null,
      warnings: warnings.get(v.row_no) ?? [],
    });
  }
  for (const i of invalid) {
    counts.invalid += 1;
    out.push({ row_no: i.row_no, status: "invalid", field: i.field, message: i.message, conflict: null, warnings: [] });
  }
  out.sort((a, b) => a.row_no - b.row_no);

  return { fingerprint, total: rows.length, counts, rows: out };
}

export async function applyImport(supabase: SupabaseClient, request: ApplyRequest): Promise<ApplyResponse> {
  const { valid, invalid } = validateAll(request.rows);
  if (valid.length === 0) {
    throw new ApiError("validation_error", "None of the rows can be imported. Fix the file and preview it again.");
  }

  const { data, error } = await supabase.rpc("import_apply", {
    p_import_id: request.import_id,
    p_file_name: request.file_name,
    p_file_kind: request.file_kind,
    p_rows: valid,
    p_invalid: invalid,
    p_fingerprint: request.fingerprint,
    p_create_similar: request.create_similar,
  });
  if (error) mapDatabaseError(error);

  const body = data as { applied: boolean; replayed?: boolean; reason?: string; import?: ImportSummary };
  if (!body.applied) {
    throw new ApiError(
      "import_changed",
      "The medicine list changed since the preview. Nothing was imported; please review the new preview.",
    );
  }
  return { applied: true, replayed: Boolean(body.replayed), import: body.import as ImportSummary };
}

function toSummary(row: Record<string, unknown>, withSkipped: boolean): ImportSummary {
  const summary: ImportSummary = {
    id: row.id as string,
    file_name: row.file_name as string,
    file_kind: row.file_kind as "csv" | "xlsx",
    submitted_rows: row.submitted_rows as number,
    created_count: row.created_count as number,
    created_similar_count: row.created_similar_count as number,
    skipped_count: row.skipped_count as number,
    status_counts: (row.status_counts as ImportSummary["status_counts"]) ?? {},
    created_at: row.created_at as string,
  };
  if (withSkipped) summary.skipped = (row.skipped as ImportSummary["skipped"]) ?? [];
  return summary;
}

export async function listImports(supabase: SupabaseClient, limit: number): Promise<{ items: ImportSummary[] }> {
  const { data, error } = await supabase
    .from("imports")
    .select(SUMMARY_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return { items: ((data ?? []) as Record<string, unknown>[]).map((r) => toSummary(r, false)) };
}

export async function getImport(supabase: SupabaseClient, id: string): Promise<ImportSummary | null> {
  const { data, error } = await supabase.from("imports").select(DETAIL_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toSummary(data as Record<string, unknown>, true) : null;
}
