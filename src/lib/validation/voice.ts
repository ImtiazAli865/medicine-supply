import { z } from "zod";
import { VOICE_LIMITS } from "@/lib/voice/types";

// Requests of the Module 008 API. The parse route validates before anything is sent to the AI; the database and the
// answer schema check everything else. No price, balance or invoice field is accepted anywhere.

/** POST /api/voice/parse. The transcript is trimmed; an empty or blank text is refused before any parse. */
export const ParseBodySchema = z.object({
  transcript: z
    .string("Say or type the order first.")
    .trim()
    .min(1, "Say or type the order first.")
    .max(VOICE_LIMITS.transcript, `The text can be at most ${VOICE_LIMITS.transcript.toLocaleString("en-US")} characters. Shorten it or split the order.`),
  parser: z.enum(["ai", "rules"], "Choose the voice service or the simple reader."),
});

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

/** GET /api/voice/diagnostics */
export const DiagnosticsQuerySchema = z.object({
  limit: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int("Use a whole number.").min(1, "Use at least 1.").max(50, "Use at most 50.").optional().default(20),
  ),
  offset: z.preprocess(emptyToUndefined, z.coerce.number().int("Use a whole number.").min(0, "Use 0 or more.").optional().default(0)),
});

export type ParseBody = z.infer<typeof ParseBodySchema>;
export type DiagnosticsQuery = z.infer<typeof DiagnosticsQuerySchema>;
