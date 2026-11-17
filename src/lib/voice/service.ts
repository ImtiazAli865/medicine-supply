import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import type { ParseBody } from "@/lib/validation/voice";
import { GeminiParser } from "./gemini";
import { buildPreview } from "./match";
import { VOICE_DIAGNOSTIC_MESSAGES, VOICE_ERROR_MESSAGES } from "./messages";
import { ParserError, type TextToOrderParser } from "./parser";
import { addDiagnostic, matchProducts, matchStores, parseAllowed } from "./repository";
import { ruleParser } from "./rules";
import type { DiagnosticKind, ParserKind, Preview } from "./types";

// The logic of POST /api/voice/parse: the AI limit, the parse, the answer check, the matching by application code and
// the diagnostic records. Nothing here is saved as an order, and nothing sent to the AI, returned to the browser or
// written to the log holds a price, a balance, a key or the transcript itself (only its length).

export interface ServiceDeps {
  /** Replaces the parser (tests pass a fake; production uses Gemini and the simple reader). */
  parserFor?: (kind: ParserKind) => TextToOrderParser;
}

function defaultParser(kind: ParserKind): TextToOrderParser {
  return kind === "ai" ? new GeminiParser() : ruleParser;
}

/** Writing a diagnostic must never block or fail the request. */
async function diagnose(
  supabase: SupabaseClient,
  kind: DiagnosticKind,
  parser: ParserKind,
  counts: { items?: number; doubtful?: number; unreadable?: number },
  transcriptLength: number,
  message: string,
): Promise<void> {
  try {
    await addDiagnostic(supabase, {
      kind,
      parser,
      items: Math.min(counts.items ?? 0, 200),
      doubtful: Math.min(counts.doubtful ?? 0, 200),
      unreadable: Math.min(counts.unreadable ?? 0, 200),
      transcriptLength,
      message,
    });
  } catch {
    // The log is best effort.
  }
}

export async function parseTranscript(supabase: SupabaseClient, body: ParseBody, deps: ServiceDeps = {}): Promise<Preview> {
  const kind = body.parser;
  const length = body.transcript.length;

  // The limit protects the paid key: it counts AI parses only, so the simple reader is always available.
  if (kind === "ai") {
    const gate = await parseAllowed(supabase);
    if (!gate.allowed) {
      await diagnose(supabase, "rate_limited", kind, {}, length, VOICE_DIAGNOSTIC_MESSAGES.rate_limited);
      throw new ApiError("rate_limited", VOICE_ERROR_MESSAGES.rate_limited);
    }
  }

  let raw;
  try {
    raw = await (deps.parserFor ?? defaultParser)(kind).parse(body.transcript);
  } catch (error) {
    const code = error instanceof ParserError ? error.code : "ai_unavailable";
    await diagnose(supabase, code, kind, {}, length, VOICE_DIAGNOSTIC_MESSAGES[code]);
    throw new ApiError(code, VOICE_ERROR_MESSAGES[code]);
  }

  // Matching by application code: the database supplies candidates, match.ts decides.
  const storeRows = raw.store ? await matchStores(supabase, raw.store) : [];
  const productRows = await matchProducts(
    supabase,
    raw.items.map((item) => item.name),
  );
  const preview = buildPreview({ parser: kind, raw, storeRows, productRows });

  const doubtful = preview.lines.filter((line) => line.state !== "matched" || line.flags.some((flag) => flag !== "duplicate_spoken")).length;
  if (kind === "rules" && preview.unreadable.length > 0) {
    await diagnose(supabase, "rules_unreadable", kind, { items: preview.lines.length, doubtful, unreadable: preview.unreadable.length }, length, "Parts of the text could not be read by the simple reader.");
  } else if (doubtful > 0 || preview.unreadable.length > 0) {
    await diagnose(supabase, "low_confidence", kind, { items: preview.lines.length, doubtful, unreadable: preview.unreadable.length }, length, "Some items need the supplier to check them.");
  }
  return preview;
}
