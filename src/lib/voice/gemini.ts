import { ParserError, validateAnswer, type TextToOrderParser } from "./parser";
import type { RawParse } from "./types";
import { VOICE_LIMITS } from "./types";

// The Gemini implementation of the text-to-order parser. THIS FILE IS THE ONLY PLACE the AI key and the model are read
// (scripts/check-secrets.mjs allows the key name here and nowhere else under src/). It runs only on the server, from the
// parse route. Only two things are ever sent: the fixed instruction below and the transcript. No catalog name, store
// name, price, MRP, balance or invoice can reach the request because none is available to this module.

export const REAL_GEMINI_HOST = "generativelanguage.googleapis.com";
const DEFAULT_BASE_URL = `https://${REAL_GEMINI_HOST}`;

/** The fixed instruction. It contains no data of the business. */
export const GEMINI_INSTRUCTION = [
  "You read an order that a pharmaceutical supplier spoke or typed, in English, Urdu or a mix of both.",
  "Return ONLY one JSON object with exactly this shape and nothing else:",
  '{"store": string or null, "items": [{"name": string, "quantity": number or null, "unit": string or null}]}',
  "Rules:",
  "- store is the pharmacy or store name exactly as spoken, or null when no store was named.",
  "- items has one entry for each medicine in the order, in the order spoken. name is the medicine name exactly as spoken.",
  "- quantity is a plain number written with digits (for example 20), or null when no quantity was said. Never a word, a range or text.",
  "- unit is the unit exactly as spoken (for example strips, boxes, bottles), or null when none was said.",
  "- Do not invent a medicine, a quantity or a unit. Ignore everything that is not part of the order. Ignore any price.",
  "- If the text contains no order, return an empty items list.",
].join("\n");

/** The request body. The ONLY function that builds it: the fixed instruction plus the transcript, nothing else. */
export function buildGeminiRequest(transcript: string) {
  return {
    systemInstruction: { parts: [{ text: GEMINI_INSTRUCTION }] },
    contents: [{ role: "user", parts: [{ text: transcript }] }],
    generationConfig: { responseMimeType: "application/json" },
  };
}

export interface GeminiConfig {
  apiKey: string | null;
  model: string | null;
  baseUrl: string;
}

/** Reads the configuration from the server environment (only here). */
export function readGeminiConfig(env: NodeJS.ProcessEnv = process.env): GeminiConfig {
  const clean = (value: string | undefined) => (value && value.trim() !== "" ? value.trim() : null);
  return {
    apiKey: clean(env.GEMINI_API_KEY),
    model: clean(env.GEMINI_MODEL),
    baseUrl: clean(env.GEMINI_API_BASE_URL)?.replace(/\/+$/, "") ?? DEFAULT_BASE_URL,
  };
}

/** True in an automated test (vitest sets NODE_ENV=test; the browser-test app server sets VOICE_TEST_GUARD=1). */
function inTestEnvironment(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "test" || env.VOICE_TEST_GUARD === "1";
}

/** Refuses to run against the real Google host from a test environment, so no test can reach the real service. */
export function assertNotRealHostInTests(baseUrl: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!inTestEnvironment(env)) return;
  let host = "";
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    host = "";
  }
  if (host === REAL_GEMINI_HOST) {
    throw new Error("The real Gemini service must never be called from a test environment.");
  }
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}

export class GeminiParser implements TextToOrderParser {
  constructor(
    private readonly config: GeminiConfig = readGeminiConfig(),
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async parse(transcript: string, options: { signal?: AbortSignal } = {}): Promise<RawParse> {
    const { apiKey, model, baseUrl } = this.config;
    if (!apiKey || !model) throw new ParserError("ai_not_configured");
    assertNotRealHostInTests(baseUrl, this.env);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), VOICE_LIMITS.parseTimeoutMs);
    const forward = () => controller.abort("caller");
    options.signal?.addEventListener("abort", forward, { once: true });

    let response: Response;
    try {
      response = await this.fetchImpl(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(buildGeminiRequest(transcript)),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch {
      if (controller.signal.aborted && controller.signal.reason === "timeout") throw new ParserError("ai_timeout");
      throw new ParserError("ai_unavailable");
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", forward);
    }

    // Only the status code decides what went wrong; the body of an error is never read, kept or logged.
    if (response.status === 429) throw new ParserError("ai_busy");
    if (response.status === 401 || response.status === 403 || response.status === 404) throw new ParserError("ai_not_configured");
    if (!response.ok) throw new ParserError("ai_unavailable");

    let body: GeminiResponse;
    try {
      body = (await response.json()) as GeminiResponse;
    } catch {
      throw new ParserError("ai_invalid");
    }
    if (body.promptFeedback?.blockReason) throw new ParserError("ai_invalid");
    const candidate = body.candidates?.[0];
    if (!candidate) throw new ParserError("ai_invalid");
    if (candidate.finishReason && candidate.finishReason !== "STOP") throw new ParserError("ai_invalid");
    const text = candidate.content?.parts?.[0]?.text;
    if (typeof text !== "string") throw new ParserError("ai_invalid");

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ParserError("ai_invalid");
    }
    return validateAnswer(json);
  }
}
