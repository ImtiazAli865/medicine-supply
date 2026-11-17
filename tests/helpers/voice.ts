import type { Candidate, Preview, PreviewLine, RawItem, RawParse } from "../../src/lib/voice/types";

// Shared pieces of the Module 008 tests (unit, PGlite, Supabase integration and the browser tests): builders, a fake
// parser, and the text of a fake browser speech engine. Nothing here calls a real service.

/** The recognisable fake key the browser-test app server uses; tests search every response and the bundle for it. */
export const KEY_SENTINEL = "test-key-sentinel-do-not-use";

/** The example sentence of the master prompt. */
export const EXAMPLE_SENTENCE = "Al Madina Medical: Panadol 20 strips, Brufen 10 strips, and cough syrup 5 bottles.";

export function rawItem(name: string, quantity: number | null = 1, unit: string | null = "strip"): RawItem {
  return { name, quantity, unit };
}

export function rawParse(store: string | null, items: RawItem[], unreadable: string[] = []): RawParse {
  return { store, items, unreadable };
}

/** The parse of the example sentence, as an AI would return it. */
export function exampleRawParse(): RawParse {
  return rawParse("Al Madina Medical", [rawItem("Panadol", 20, "strips"), rawItem("Brufen", 10, "strips"), rawItem("cough syrup", 5, "bottles")]);
}

export function candidate(id: string, name: string, extra: Partial<Candidate> = {}): Candidate {
  return { id, name, is_exact: false, unit: "strip", ...extra };
}

export function previewLine(key: string, spoken: string, extra: Partial<PreviewLine> = {}): PreviewLine {
  return { key, spoken, state: "unknown", candidates: [], productId: null, quantity: 1, unit: "strip", flags: [], ...extra };
}

export function preview(lines: PreviewLine[], extra: Partial<Preview> = {}): Preview {
  return {
    parser: "ai",
    store: { spoken: "Al Madina Medical", state: "unknown", candidates: [], storeId: null },
    more_than_one_store: false,
    lines,
    unreadable: [],
    ...extra,
  };
}

/** What the unit and integration tests give the voice service in place of Gemini. */
export interface ParserLike {
  parse(transcript: string, options?: { signal?: AbortSignal }): Promise<RawParse>;
}

/** A parser that returns a scripted result, or throws a scripted failure, and remembers every transcript it was given. */
export class FakeParser implements ParserLike {
  readonly calls: string[] = [];

  constructor(private readonly behaviour: RawParse | Error | ((transcript: string) => RawParse | Error)) {}

  async parse(transcript: string): Promise<RawParse> {
    this.calls.push(transcript);
    const result = typeof this.behaviour === "function" ? this.behaviour(transcript) : this.behaviour;
    if (result instanceof Error) throw result;
    return result;
  }
}

/**
 * The text of a fake browser speech engine for Playwright's `addInitScript`. It defines `window.SpeechRecognition`
 * and `window.__fakeSpeech`, which a test drives from the page: `say(text, final)` pushes words (interim or final),
 * `fail(name)` raises a browser error such as `not-allowed`, `finish()` ends the session. `calls` records every start,
 * stop and the language, so a test can assert what the app asked for. It never records or touches audio.
 */
export function fakeSpeechInitScript(options: { unsupported?: boolean; unsupportedLangs?: string[] } = {}): string {
  if (options.unsupported) {
    return `delete window.SpeechRecognition; delete window.webkitSpeechRecognition;`;
  }
  const unsupportedLangs = JSON.stringify(options.unsupportedLangs ?? []);
  return `
(() => {
  const unsupportedLangs = ${unsupportedLangs};
  const calls = [];
  let active = null;
  class FakeSpeechRecognition {
    constructor() {
      this.lang = "";
      this.continuous = false;
      this.interimResults = false;
      this.onresult = null; this.onerror = null; this.onend = null; this.onstart = null;
      this._results = [];
    }
    start() {
      calls.push({ type: "start", lang: this.lang, continuous: this.continuous, interimResults: this.interimResults });
      if (unsupportedLangs.includes(this.lang)) {
        setTimeout(() => { this.onerror && this.onerror({ error: "language-not-supported" }); this.onend && this.onend({}); }, 0);
        return;
      }
      active = this;
      setTimeout(() => { this.onstart && this.onstart({}); }, 0);
    }
    stop() { calls.push({ type: "stop" }); if (active === this) { const a = this; active = null; setTimeout(() => a.onend && a.onend({}), 0); } }
    abort() { calls.push({ type: "abort" }); if (active === this) { const a = this; active = null; setTimeout(() => a.onend && a.onend({}), 0); } }
  }
  window.SpeechRecognition = FakeSpeechRecognition;
  window.webkitSpeechRecognition = FakeSpeechRecognition;
  window.__fakeSpeech = {
    calls,
    say(text, final = true) {
      const rec = active; if (!rec || !rec.onresult) return false;
      const alt = { transcript: text, confidence: 0.9 };
      const result = Object.assign([alt], { isFinal: final, length: 1, item: () => alt });
      if (final) rec._results.push(result);
      const list = Object.assign(final ? rec._results.slice() : rec._results.concat([result]), { item: (i) => list[i] });
      rec.onresult({ resultIndex: final ? rec._results.length - 1 : rec._results.length, results: list });
      return true;
    },
    fail(name) { const rec = active; if (!rec) return false; active = null; rec.onerror && rec.onerror({ error: name }); rec.onend && rec.onend({}); return true; },
    finish() { const rec = active; if (!rec) return false; active = null; rec.onend && rec.onend({}); return true; },
  };
})();
`;
}
