import { z } from "zod";
import type { VoiceFailureCode } from "./messages";
import type { ParserKind, RawParse } from "./types";
import { VOICE_LIMITS } from "./types";

// The text-to-order parser interface (Gemini is the first implementation, the rule-based reader the fallback) and the
// strict schema every answer must fit. A wrong structure refuses the WHOLE answer; extra fields (such as a price) are
// dropped; a numeric but doubtful quantity passes and is flagged later (match.ts), never rounded.

/** A failure of the parser, with the code the route turns into the documented message. No secret is ever put in it. */
export class ParserError extends Error {
  readonly code: Exclude<VoiceFailureCode, "rate_limited">;

  constructor(code: Exclude<VoiceFailureCode, "rate_limited">) {
    super(code);
    this.name = "ParserError";
    this.code = code;
  }
}

export interface TextToOrderParser {
  /** Turns a transcript into a draft list. Throws ParserError. Never decides what a name means. */
  parse(transcript: string, options?: { signal?: AbortSignal }): Promise<RawParse>;
}

const nullable = <T extends z.ZodType>(schema: T) => schema.nullish().transform((value) => value ?? null);

const ItemSchema = z.object({
  name: z.string().trim().min(1).max(VOICE_LIMITS.name),
  // A number or null. Whether it is a usable whole quantity is decided later; a string is a schema violation.
  quantity: nullable(z.number()),
  unit: nullable(z.string().trim().max(VOICE_LIMITS.unit)),
});

export const AnswerSchema = z.object({
  store: nullable(z.string().trim().max(VOICE_LIMITS.store)),
  items: z.array(ItemSchema).max(VOICE_LIMITS.lines),
});

/** Validates the parsed JSON of an AI answer. Refuses the whole answer on a wrong shape. */
export function validateAnswer(value: unknown): RawParse {
  const parsed = AnswerSchema.safeParse(value);
  if (!parsed.success) throw new ParserError("ai_invalid");
  return {
    store: parsed.data.store === "" ? null : parsed.data.store,
    items: parsed.data.items.map((item) => ({ name: item.name, quantity: item.quantity, unit: item.unit === "" ? null : item.unit })),
    unreadable: [],
  };
}

export type { ParserKind };
