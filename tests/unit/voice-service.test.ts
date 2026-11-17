import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { ParserError } from "@/lib/voice/parser";
import { parseTranscript } from "@/lib/voice/service";
import { candidate, exampleRawParse, FakeParser, rawItem, rawParse } from "../helpers/voice";

// The logic of the parse route with a stubbed database client and a fake parser: the AI limit, the order of the steps,
// matching by application code, and the diagnostic records (counts and length only).

type Handler = (args: Record<string, unknown>) => unknown;

function stubClient(handlers: Record<string, Handler>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const handler = handlers[name];
      if (!handler) return { data: null, error: { message: `no handler for ${name}` } };
      try {
        return { data: handler(args), error: null };
      } catch (error) {
        return { data: null, error: { message: String(error) } };
      }
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const exactStore = candidate("store-1", "Al Madina Medical", { is_exact: true });
const baseHandlers = (overrides: Record<string, Handler> = {}): Record<string, Handler> => ({
  voice_parse_allow: () => ({ allowed: true }),
  voice_match_stores: () => [exactStore],
  voice_match_products: () => [
    { idx: 0, ...candidate("p-panadol", "Panadol", { is_exact: true, unit: "strip" }), score: 1 },
    { idx: 1, ...candidate("p-brufen", "Brufen", { is_exact: true, unit: "box" }), score: 1 },
    { idx: 2, ...candidate("p-calpol", "Cough syrup", { is_exact: true, unit: "bottle" }), score: 1 },
  ],
  voice_diag_add: () => ({ done: true }),
  ...overrides,
});

const TRANSCRIPT = "Al Madina Medical: Panadol 20 strips, Brufen 10 strips, and cough syrup 5 bottles.";
const names = (calls: Array<{ name: string }>) => calls.map((c) => c.name);

describe("parseTranscript with the AI parser", () => {
  it("checks the limit first, then parses, then matches, and returns a preview with no diagnostic when nothing is doubtful", async () => {
    const parser = new FakeParser(exampleRawParse());
    const { client, calls } = stubClient(baseHandlers());
    const preview = await parseTranscript(client, { transcript: TRANSCRIPT, parser: "ai" }, { parserFor: () => parser });

    expect(names(calls)).toEqual(["voice_parse_allow", "voice_match_stores", "voice_match_products"]);
    expect(parser.calls).toEqual([TRANSCRIPT]);
    expect(preview.parser).toBe("ai");
    expect(preview.store).toMatchObject({ state: "matched", storeId: "store-1" });
    expect(preview.lines.map((l) => l.state)).toEqual(["matched", "matched", "matched"]);
    expect(preview.lines.map((l) => l.quantity)).toEqual([20, 10, 5]);
    expect(calls.some((c) => c.name === "voice_diag_add")).toBe(false);
  });

  it("sends only the spoken names to the matching functions, never a price or a balance", async () => {
    const { client, calls } = stubClient(baseHandlers());
    await parseTranscript(client, { transcript: TRANSCRIPT, parser: "ai" }, { parserFor: () => new FakeParser(exampleRawParse()) });
    const productCall = calls.find((c) => c.name === "voice_match_products");
    expect(productCall?.args).toEqual({ p_names: ["Panadol", "Brufen", "cough syrup"] });
    expect(calls.find((c) => c.name === "voice_match_stores")?.args).toEqual({ p_name: "Al Madina Medical" });
    expect(JSON.stringify(calls)).not.toMatch(/price|mrp|cost|balance|invoice/i);
  });

  it("refuses with rate_limited before any parse when the limit is reached, and logs it", async () => {
    const parser = new FakeParser(exampleRawParse());
    const { client, calls } = stubClient(baseHandlers({ voice_parse_allow: () => ({ allowed: false, retry_after_seconds: 30 }) }));
    await expect(parseTranscript(client, { transcript: TRANSCRIPT, parser: "ai" }, { parserFor: () => parser })).rejects.toMatchObject({ code: "rate_limited", status: 429 });
    expect(parser.calls).toHaveLength(0);
    expect(names(calls)).toEqual(["voice_parse_allow", "voice_diag_add"]);
    expect(calls[1].args).toMatchObject({ p_kind: "rate_limited", p_parser: "ai", p_transcript_length: TRANSCRIPT.length });
  });

  it("maps every parser failure to its documented error and records a diagnostic without the transcript", async () => {
    const cases: Array<[ParserError | Error, string, number]> = [
      [new ParserError("ai_busy"), "ai_busy", 503],
      [new ParserError("ai_timeout"), "ai_timeout", 504],
      [new ParserError("ai_invalid"), "ai_invalid", 502],
      [new ParserError("ai_unavailable"), "ai_unavailable", 502],
      [new ParserError("ai_not_configured"), "ai_not_configured", 503],
      [new Error("something unexpected"), "ai_unavailable", 502],
    ];
    for (const [failure, code, status] of cases) {
      const { client, calls } = stubClient(baseHandlers());
      const error = await parseTranscript(client, { transcript: TRANSCRIPT, parser: "ai" }, { parserFor: () => new FakeParser(failure) }).catch((e) => e);
      expect(error, code).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code, status });
      const diag = calls.find((c) => c.name === "voice_diag_add");
      expect(diag?.args, code).toMatchObject({ p_kind: code, p_parser: "ai", p_transcript_length: TRANSCRIPT.length });
      // the log gets counts and the length only
      expect(JSON.stringify(diag?.args)).not.toContain("Panadol");
      expect(calls.some((c) => c.name.startsWith("voice_match_"))).toBe(false);
    }
  });

  it("writes one low_confidence record when items are doubtful, with counts only", async () => {
    const raw = rawParse("Al Madina Medical", [rawItem("Panadol", 20, "strips"), rawItem("Xyzzin", 3, "box")]);
    const { client, calls } = stubClient(
      baseHandlers({ voice_match_products: () => [{ idx: 0, ...candidate("p1", "Panadol", { is_exact: true }), score: 1 }] }),
    );
    const preview = await parseTranscript(client, { transcript: "t", parser: "ai" }, { parserFor: () => new FakeParser(raw) });
    expect(preview.lines.map((l) => l.state)).toEqual(["matched", "unknown"]);
    const diags = calls.filter((c) => c.name === "voice_diag_add");
    expect(diags).toHaveLength(1);
    expect(diags[0].args).toMatchObject({ p_kind: "low_confidence", p_items: 2, p_doubtful: 1, p_unreadable: 0 });
  });

  it("does not let a failing diagnostic write block the answer", async () => {
    const raw = rawParse(null, [rawItem("Unknown thing", 1, "box")]);
    const { client } = stubClient(baseHandlers({ voice_match_products: () => [], voice_diag_add: () => { throw new Error("log down"); } }));
    const preview = await parseTranscript(client, { transcript: "t", parser: "ai" }, { parserFor: () => new FakeParser(raw) });
    expect(preview.lines).toHaveLength(1);
  });

  it("skips the store lookup when no store was spoken", async () => {
    const { client, calls } = stubClient(baseHandlers({ voice_match_products: () => [] }));
    const preview = await parseTranscript(client, { transcript: "t", parser: "ai" }, { parserFor: () => new FakeParser(rawParse(null, [rawItem("Thing", 1, "box")])) });
    expect(preview.store.state).toBe("not_named");
    expect(names(calls)).not.toContain("voice_match_stores");
  });
});

describe("parseTranscript with the simple reader", () => {
  it("never calls the AI limit and reads a clear sentence", async () => {
    const { client, calls } = stubClient(baseHandlers({ voice_match_products: () => [] }));
    const preview = await parseTranscript(client, { transcript: "Nimer: Panadol 20 strips, Brufen 10 box", parser: "rules" });
    expect(names(calls)).not.toContain("voice_parse_allow");
    expect(preview.parser).toBe("rules");
    expect(preview.lines.map((l) => [l.spoken, l.quantity, l.unit])).toEqual([
      ["Panadol", 20, "strips"],
      ["Brufen", 10, "box"],
    ]);
  });

  it("records rules_unreadable when a part cannot be read, and still returns the readable lines", async () => {
    const { client, calls } = stubClient(baseHandlers({ voice_match_products: () => [] }));
    const preview = await parseTranscript(client, { transcript: "Nimer: Panadol 20 strips, twenty Brufen", parser: "rules" });
    expect(preview.unreadable).toEqual(["twenty Brufen"]);
    expect(preview.lines).toHaveLength(1);
    expect(calls.find((c) => c.name === "voice_diag_add")?.args).toMatchObject({ p_kind: "rules_unreadable", p_parser: "rules", p_unreadable: 1 });
  });
});
