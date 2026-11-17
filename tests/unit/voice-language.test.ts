import { afterEach, describe, expect, it, vi } from "vitest";
import { LANGUAGE_TAGS, VOICE_LANGUAGES, isVoiceLanguage, readLanguage, writeLanguage } from "@/lib/voice/language";

// The language preference (research D2): English or Urdu, a lightweight preference in localStorage, always read and
// written inside try/catch, falling back to English when storage is blocked or holds junk.

function stubStorage(storage: Partial<Storage> | null) {
  vi.stubGlobal("window", storage === null ? {} : { localStorage: storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the choices", () => {
  it("offers English and Urdu with the browser tags en-PK (retry en-US) and ur-PK (no fallback)", () => {
    expect(VOICE_LANGUAGES.map((l) => l.value)).toEqual(["en", "ur"]);
    expect(LANGUAGE_TAGS.en).toEqual({ primary: "en-PK", fallback: "en-US" });
    expect(LANGUAGE_TAGS.ur).toEqual({ primary: "ur-PK", fallback: null });
    expect(isVoiceLanguage("en")).toBe(true);
    expect(isVoiceLanguage("ur")).toBe(true);
    expect(isVoiceLanguage("fr")).toBe(false);
    expect(isVoiceLanguage(null)).toBe(false);
  });
});

describe("readLanguage and writeLanguage", () => {
  it("remembers the choice", () => {
    const store = new Map<string, string>();
    stubStorage({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) });
    expect(readLanguage()).toBe("en");
    writeLanguage("ur");
    expect(readLanguage()).toBe("ur");
    writeLanguage("en");
    expect(readLanguage()).toBe("en");
  });

  it("falls back to English for junk in storage", () => {
    for (const junk of ["", "fr", "UR", "{}", "null"]) {
      stubStorage({ getItem: () => junk });
      expect(readLanguage(), junk).toBe("en");
    }
    stubStorage({ getItem: () => null });
    expect(readLanguage()).toBe("en");
  });

  it("falls back to English when storage throws or does not exist", () => {
    stubStorage({
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readLanguage()).toBe("en");
    stubStorage(null);
    expect(readLanguage()).toBe("en");
  });

  it("does not throw when storage cannot be written", () => {
    stubStorage({
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(() => writeLanguage("ur")).not.toThrow();
    stubStorage(null);
    expect(() => writeLanguage("ur")).not.toThrow();
  });
});
