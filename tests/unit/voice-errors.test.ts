import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiParser } from "@/lib/voice/gemini";
import { VOICE_DIAGNOSTIC_MESSAGES, VOICE_ERROR_MESSAGES } from "@/lib/voice/messages";
import { ParserError } from "@/lib/voice/parser";
import { VOICE_LIMITS } from "@/lib/voice/types";

// Every upstream result maps to its own app error (research D3), decided by the status code only; the messages are the
// contract text and never contain a key, a model, an upstream body or a stack.

const SECRET = "super-secret-key-value-123";
const config = { apiKey: SECRET, model: "unit-test-model", baseUrl: "http://127.0.0.1:9" };
const testEnv = { NODE_ENV: "test" } as unknown as NodeJS.ProcessEnv;

const answerWith = (status: number, body: unknown = {}) => (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;
const parserWith = (fetchImpl: typeof fetch) => new GeminiParser(config, fetchImpl, testEnv);
const codeOf = async (parser: GeminiParser) => {
  try {
    await parser.parse("Panadol 20 strips");
  } catch (error) {
    return error instanceof ParserError ? error.code : `other:${String(error)}`;
  }
  return "no error";
};
const okBody = (text: unknown, finishReason: string | undefined = "STOP") => ({ candidates: [{ finishReason, content: { parts: [{ text }] } }] });

afterEach(() => {
  vi.useRealTimers();
});

describe("status codes", () => {
  it("maps 429 to ai_busy", async () => {
    expect(await codeOf(parserWith(answerWith(429, { error: { status: "RESOURCE_EXHAUSTED" } })))).toBe("ai_busy");
  });

  it("maps 401, 403 and 404 to ai_not_configured", async () => {
    for (const status of [401, 403, 404]) expect(await codeOf(parserWith(answerWith(status))), String(status)).toBe("ai_not_configured");
  });

  it("maps other upstream errors to ai_unavailable", async () => {
    for (const status of [400, 500, 502, 503, 504]) expect(await codeOf(parserWith(answerWith(status))), String(status)).toBe("ai_unavailable");
  });

  it("maps a network failure to ai_unavailable", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await codeOf(parserWith(failing))).toBe("ai_unavailable");
  });
});

describe("the time limit", () => {
  it("maps no answer within 15 seconds to ai_timeout", async () => {
    vi.useFakeTimers();
    const never = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
    const pending = codeOf(parserWith(never));
    await vi.advanceTimersByTimeAsync(VOICE_LIMITS.parseTimeoutMs + 10);
    expect(await pending).toBe("ai_timeout");
  });

  it("does not time out an answer that arrives in time", async () => {
    const parser = parserWith(answerWith(200, okBody(JSON.stringify({ store: null, items: [] }))));
    await expect(parser.parse("x")).resolves.toEqual({ store: null, items: [], unreadable: [] });
  });
});

describe("answers that cannot be used", () => {
  it("maps invalid JSON, a wrong shape, a missing candidate, a blocked prompt and an unfinished answer to ai_invalid", async () => {
    const cases: Array<[string, unknown]> = [
      ["not JSON at all", "this is not json"],
      ["text that is not JSON", okBody("not json")],
      ["a wrong shape", okBody(JSON.stringify({ store: "x", items: "nope" }))],
      ["a string quantity", okBody(JSON.stringify({ store: null, items: [{ name: "Panadol", quantity: "20", unit: "strip" }] }))],
      ["no candidates", {}],
      ["an empty candidate list", { candidates: [] }],
      ["a blocked prompt", { promptFeedback: { blockReason: "SAFETY" } }],
      ["an answer stopped for safety", okBody(JSON.stringify({ store: null, items: [] }), "SAFETY")],
      ["an answer cut off", okBody(JSON.stringify({ store: null, items: [] }), "MAX_TOKENS")],
      ["no text part", { candidates: [{ finishReason: "STOP", content: { parts: [{}] } }] }],
    ];
    for (const [label, body] of cases) expect(await codeOf(parserWith(answerWith(200, body))), label).toBe("ai_invalid");
  });

  it("accepts an answer without a finish reason when the text is a valid draft", async () => {
    const parser = parserWith(answerWith(200, okBody(JSON.stringify({ store: "Nimer", items: [{ name: "Panadol", quantity: 20, unit: "strips" }] }), undefined)));
    expect((await parser.parse("x")).items).toHaveLength(1);
  });
});

describe("configuration", () => {
  it("answers ai_not_configured when the key or the model is missing", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    for (const bad of [{ ...config, apiKey: null }, { ...config, model: null }]) {
      expect(await codeOf(new GeminiParser(bad, fetchImpl, testEnv))).toBe("ai_not_configured");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("the messages", () => {
  it("are the documented plain text, one for each code", () => {
    expect(VOICE_ERROR_MESSAGES).toEqual({
      rate_limited: "Too many voice requests. Wait a moment and try again.",
      ai_busy: "The voice service is busy. Try again in a moment.",
      ai_timeout: "The voice service took too long. Try again or use the simple reader.",
      ai_invalid: "The answer could not be understood. Try again or edit the text.",
      ai_unavailable: "The voice service could not be reached. Try again or use the simple reader.",
      ai_not_configured: "Voice understanding is not set up on the server. Use the simple reader or take the order by hand.",
    });
  });

  it("never contain a key, a model, an address or an upstream body, and the diagnostic ones are short", () => {
    // what the supplier sees names no key or model at all
    for (const text of Object.values(VOICE_ERROR_MESSAGES)) {
      expect(text).not.toMatch(/key|model|token|secret|http|googleapis|RESOURCE_EXHAUSTED|stack/i);
    }
    // the owner's log may say that a key or model is missing, but never an address, a status string or a value
    for (const text of Object.values(VOICE_DIAGNOSTIC_MESSAGES)) {
      expect(text).not.toMatch(/http|googleapis|RESOURCE_EXHAUSTED|stack|=|sk-|AIza/i);
      expect(text.length).toBeLessThanOrEqual(200);
    }
  });

  it("a failure carries no secret even when the upstream echoed one", async () => {
    const echo = answerWith(401, { error: { message: `API key ${SECRET} is not valid` } });
    try {
      await parserWith(echo).parse("x");
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(SECRET);
      expect(String((error as Error).message)).not.toContain(SECRET);
      expect(String((error as Error).stack ?? "")).not.toContain(SECRET);
    }
  });
});
