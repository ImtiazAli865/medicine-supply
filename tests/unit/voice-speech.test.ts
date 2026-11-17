import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserSpeechProvider, SPEECH_ERROR_MESSAGES, UNSUPPORTED_MESSAGE, mapSpeechError, type SpeechErrorCode } from "@/lib/voice/speech";

// Speech to text on the device (research D2): support is detected at run time, every browser error name maps to its own
// plain message, and the provider only reads the browser's results; it never records or stores audio.

class FakeRecognition {
  static last: FakeRecognition | null = null;
  static throwOnStart = false;
  lang = "";
  continuous = false;
  interimResults = false;
  onstart: (() => void) | null = null;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  stopped = false;
  aborted = false;

  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    if (FakeRecognition.throwOnStart) throw new Error("already started");
    this.started = true;
    this.onstart?.();
  }
  stop() {
    this.stopped = true;
    this.onend?.();
  }
  abort() {
    this.aborted = true;
    this.onend?.();
  }
}

const result = (text: string, isFinal: boolean) => Object.assign([{ transcript: text }], { isFinal, length: 1 });
const event = (resultIndex: number, results: Array<ReturnType<typeof result>>) => ({ resultIndex, results: Object.assign(results, { length: results.length }) });

afterEach(() => {
  vi.unstubAllGlobals();
  FakeRecognition.last = null;
  FakeRecognition.throwOnStart = false;
});

describe("mapSpeechError", () => {
  it("maps every browser error name to its code", () => {
    const expected: Record<string, SpeechErrorCode> = {
      "not-allowed": "permission_denied",
      "service-not-allowed": "service_not_allowed",
      "no-speech": "no_speech",
      "audio-capture": "no_microphone",
      network: "network",
      "language-not-supported": "language_not_supported",
      aborted: "aborted",
      "bad-grammar": "unknown",
      "phrases-not-supported": "unknown",
    };
    for (const [name, code] of Object.entries(expected)) expect(mapSpeechError(name), name).toBe(code);
    expect(mapSpeechError(undefined)).toBe("unknown");
    expect(mapSpeechError("something-new")).toBe("unknown");
  });

  it("has a plain message for each problem, none of them promising offline or universal support", () => {
    const codes: Array<Exclude<SpeechErrorCode, "aborted">> = ["permission_denied", "service_not_allowed", "no_speech", "no_microphone", "network", "language_not_supported", "unknown"];
    for (const code of codes) {
      expect(SPEECH_ERROR_MESSAGES[code], code).toMatch(/\S/);
      expect(SPEECH_ERROR_MESSAGES[code]).not.toMatch(/offline|any phone|all phones|always works/i);
    }
    expect(new Set(codes.map((c) => SPEECH_ERROR_MESSAGES[c])).size).toBe(codes.length);
    expect(SPEECH_ERROR_MESSAGES.permission_denied).toMatch(/microphone/i);
    expect(SPEECH_ERROR_MESSAGES.network).toMatch(/connection/i);
    expect(UNSUPPORTED_MESSAGE).toMatch(/keyboard|type/i);
  });
});

describe("support detection", () => {
  it("finds SpeechRecognition and the prefixed constructor, and reports unsupported otherwise", () => {
    vi.stubGlobal("window", { SpeechRecognition: FakeRecognition });
    expect(new BrowserSpeechProvider().isSupported()).toBe(true);
    vi.stubGlobal("window", { webkitSpeechRecognition: FakeRecognition });
    expect(new BrowserSpeechProvider().isSupported()).toBe(true);
    vi.stubGlobal("window", {});
    expect(new BrowserSpeechProvider().isSupported()).toBe(false);
    vi.unstubAllGlobals();
    expect(new BrowserSpeechProvider().isSupported()).toBe(false);
  });
});

describe("BrowserSpeechProvider", () => {
  function setup() {
    vi.stubGlobal("window", { SpeechRecognition: FakeRecognition });
    const calls = { start: 0, results: [] as Array<{ final: string; interim: string }>, errors: [] as SpeechErrorCode[], end: 0 };
    new BrowserSpeechProvider().start({
      lang: "ur-PK",
      onStart: () => (calls.start += 1),
      onResult: (text) => calls.results.push(text),
      onError: (code) => calls.errors.push(code),
      onEnd: () => (calls.end += 1),
    });
    return { calls, recognition: FakeRecognition.last as FakeRecognition };
  }

  it("asks for the chosen language with continuous and interim results, and reports the start", () => {
    const { calls, recognition } = setup();
    expect(recognition).toMatchObject({ lang: "ur-PK", continuous: true, interimResults: true, started: true });
    expect(calls.start).toBe(1);
  });

  it("accumulates final text, shows interim words separately, and never changes final text", () => {
    const { calls, recognition } = setup();
    recognition.onresult?.(event(0, [result("Panadol", false)]));
    recognition.onresult?.(event(0, [result("Panadol 20 strips", true)]));
    recognition.onresult?.(event(1, [result("Panadol 20 strips", true), result("Brufen", false)]));
    recognition.onresult?.(event(1, [result("Panadol 20 strips", true), result("Brufen 10", true)]));
    expect(calls.results.map((r) => r.final)).toEqual(["", "Panadol 20 strips", "Panadol 20 strips", "Panadol 20 strips Brufen 10"]);
    expect(calls.results.map((r) => r.interim)).toEqual(["Panadol", "", "Brufen", ""]);
  });

  it("maps a browser error and reports the end", () => {
    const { calls, recognition } = setup();
    recognition.onerror?.({ error: "not-allowed" });
    recognition.onerror?.({ error: "no-speech" });
    recognition.onerror?.({ error: "network" });
    recognition.onend?.();
    expect(calls.errors).toEqual(["permission_denied", "no_speech", "network"]);
    expect(calls.end).toBe(1);
  });

  it("stops and aborts the running session", () => {
    vi.stubGlobal("window", { SpeechRecognition: FakeRecognition });
    const provider = new BrowserSpeechProvider();
    provider.start({ lang: "en-PK", onResult: () => undefined, onError: () => undefined, onEnd: () => undefined });
    const recognition = FakeRecognition.last as FakeRecognition;
    provider.stop();
    expect(recognition.stopped).toBe(true);
    provider.start({ lang: "en-PK", onResult: () => undefined, onError: () => undefined, onEnd: () => undefined });
    const second = FakeRecognition.last as FakeRecognition;
    provider.abort();
    expect(second.aborted).toBe(true);
  });

  it("reports an unknown error and an end when start throws, and a refusal when unsupported", () => {
    vi.stubGlobal("window", { SpeechRecognition: FakeRecognition });
    FakeRecognition.throwOnStart = true;
    const errors: SpeechErrorCode[] = [];
    let ended = 0;
    new BrowserSpeechProvider().start({ lang: "en-PK", onResult: () => undefined, onError: (c) => errors.push(c), onEnd: () => (ended += 1) });
    expect(errors).toEqual(["unknown"]);
    expect(ended).toBe(1);

    vi.stubGlobal("window", {});
    const refused: SpeechErrorCode[] = [];
    new BrowserSpeechProvider().start({ lang: "en-PK", onResult: () => undefined, onError: (c) => refused.push(c), onEnd: () => undefined });
    expect(refused).toEqual(["service_not_allowed"]);
  });

  it("never touches audio: it only reads the browser's text results", () => {
    const { recognition } = setup();
    expect(Object.keys(recognition).join(" ")).not.toMatch(/audio|record|blob|stream/i);
  });
});
