import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, noBusiness } from "@/lib/api/errors";
import type { DiagnosticsQuery } from "@/lib/validation/voice";
import type { Candidate, DiagnosticKind, DiagnosticPage, ParserKind } from "./types";

// The voice database functions (migration 0009), called with the signed-in user's session. The functions read the
// business from the session. None of them accepts or returns a price, MRP, cost, balance or invoice field.

async function call(supabase: SupabaseClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (error.message?.includes("no_business")) throw noBusiness();
    throw error;
  }
  return data;
}

/** Checks and records one AI parse against the per-minute limit. The rule-based parser never calls this. */
export async function parseAllowed(supabase: SupabaseClient): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const data = (await call(supabase, "voice_parse_allow", {})) as { allowed: boolean; retry_after_seconds?: number };
  return { allowed: data.allowed === true, retryAfterSeconds: data.retry_after_seconds ?? 0 };
}

export interface DiagnosticInput {
  kind: DiagnosticKind;
  parser: ParserKind;
  items: number;
  doubtful: number;
  unreadable: number;
  transcriptLength: number;
  /** A short safe sentence: never a transcript, a key, an upstream body, a price or a balance. */
  message: string | null;
}

/** Appends one diagnostic record (counts and the transcript LENGTH only). */
export async function addDiagnostic(supabase: SupabaseClient, input: DiagnosticInput): Promise<void> {
  const data = (await call(supabase, "voice_diag_add", {
    p_kind: input.kind,
    p_parser: input.parser,
    p_items: input.items,
    p_doubtful: input.doubtful,
    p_unreadable: input.unreadable,
    p_transcript_length: input.transcriptLength,
    p_message: input.message,
  })) as { done: boolean; reason?: string };
  if (data.done !== true) throw new ApiError("server_error", "Something went wrong. Please try again.");
}

export async function listDiagnostics(supabase: SupabaseClient, query: DiagnosticsQuery): Promise<DiagnosticPage> {
  return (await call(supabase, "voice_diag_list", { p_limit: query.limit, p_offset: query.offset })) as DiagnosticPage;
}

export interface ProductCandidateRow extends Candidate {
  idx: number;
  score: number;
}

/** Up to five active candidates for each spoken product name (facts only; the decision is made in match.ts). */
export async function matchProducts(supabase: SupabaseClient, names: string[]): Promise<ProductCandidateRow[]> {
  if (names.length === 0) return [];
  const data = (await call(supabase, "voice_match_products", { p_names: names })) as ProductCandidateRow[] | null;
  return data ?? [];
}

export interface StoreCandidateRow extends Candidate {
  score: number;
}

/** Up to five active candidates for the spoken store name. */
export async function matchStores(supabase: SupabaseClient, name: string): Promise<StoreCandidateRow[]> {
  const data = (await call(supabase, "voice_match_stores", { p_name: name })) as StoreCandidateRow[] | null;
  return data ?? [];
}
