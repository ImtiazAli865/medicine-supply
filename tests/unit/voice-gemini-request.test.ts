import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GEMINI_INSTRUCTION, GeminiParser, REAL_GEMINI_HOST, assertNotRealHostInTests, buildGeminiRequest, readGeminiConfig } from "@/lib/voice/gemini";
import { KEY_SENTINEL } from "../helpers/voice";

// What is sent to the AI (Module 008, SC-004): the fixed instruction and the transcript, nothing else; the key only in a
// header; the model only from the environment; and a guard so no test can reach the real service.

const TRANSCRIPT = "Al Madina Medical: Panadol 20 strips, Brufen 10 strips";

/** An environment for a test: only the named variables. */
const envOf = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

describe("buildGeminiRequest", () => {
  it("holds only the fixed instruction and the transcript", () => {
    expect(buildGeminiRequest(TRANSCRIPT)).toEqual({
      systemInstruction: { parts: [{ text: GEMINI_INSTRUCTION }] },
      contents: [{ role: "user", parts: [{ text: TRANSCRIPT }] }],
      generationConfig: { responseMimeType: "application/json" },
    });
  });

  it("changes only in the transcript: the same instruction for every order", () => {
    const one = JSON.stringify(buildGeminiRequest("first order"));
    const two = JSON.stringify(buildGeminiRequest("second order"));
    expect(one.replace("first order", "X")).toBe(two.replace("second order", "X"));
  });

  it("names no catalog, store, price, balance or invoice, and does not mention a key", () => {
    expect(GEMINI_INSTRUCTION).not.toMatch(/catalog|inventory|balance|invoice|ledger|discount/i);
    expect(GEMINI_INSTRUCTION).not.toMatch(/api[_ ]?key|secret|token/i);
    // the instruction tells the model to ignore prices; it never asks for one
    expect(GEMINI_INSTRUCTION).toMatch(/ignore any price/i);
    const body = JSON.stringify(buildGeminiRequest(TRANSCRIPT));
    expect(body).not.toMatch(/"(price|mrp|cost|balance|selling_price|purchase_price)"/i);
  });
});

describe("readGeminiConfig", () => {
  it("reads the key, the model and the base address from the environment, and defaults the base to the real host", () => {
    expect(readGeminiConfig(envOf({ GEMINI_API_KEY: " k ", GEMINI_MODEL: " some-model ", GEMINI_API_BASE_URL: "http://127.0.0.1:4010/" }))).toEqual({
      apiKey: "k",
      model: "some-model",
      baseUrl: "http://127.0.0.1:4010",
    });
    const empty = readGeminiConfig(envOf({ GEMINI_API_KEY: "", GEMINI_MODEL: "  " }));
    expect(empty.apiKey).toBeNull();
    expect(empty.model).toBeNull();
    expect(new URL(empty.baseUrl).hostname).toBe(REAL_GEMINI_HOST);
  });

  it("is the only place a model is named: no model name is hardcoded under src/", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(full)) files.push(full);
      }
    };
    walk(path.resolve(__dirname, "../../src"));
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/gemini-(?:\d|pro|flash|ultra|nano)/i);
    }
  });
});

describe("GeminiParser with a captured request", () => {
  const config = { apiKey: "unit-test-key", model: "unit-test-model", baseUrl: "http://127.0.0.1:9" };

  it("sends the key in a header only, the model in the path, and the exact body", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ store: null, items: [] }) }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await new GeminiParser(config, fake, envOf({ NODE_ENV: "test" })).parse(TRANSCRIPT);

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("http://127.0.0.1:9/v1beta/models/unit-test-model:generateContent");
    expect(seen[0].url).not.toContain("unit-test-key");
    expect((seen[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe("unit-test-key");
    expect(String(seen[0].init.body)).not.toContain("unit-test-key");
    expect(JSON.parse(String(seen[0].init.body))).toEqual(buildGeminiRequest(TRANSCRIPT));
  });

  it("answers ai_not_configured, without any request, when the key or the model is missing", async () => {
    const fake = vi.fn() as unknown as typeof fetch;
    for (const bad of [{ ...config, apiKey: null }, { ...config, model: null }]) {
      await expect(new GeminiParser(bad, fake, envOf({ NODE_ENV: "test" })).parse(TRANSCRIPT)).rejects.toMatchObject({ code: "ai_not_configured" });
    }
    expect(fake).not.toHaveBeenCalled();
  });
});

describe("the real-host guard", () => {
  const real = `https://${REAL_GEMINI_HOST}`;

  it("refuses the real Google host in a test environment, and allows a local fake", () => {
    expect(() => assertNotRealHostInTests(real, envOf({ NODE_ENV: "test" }))).toThrow(/test environment/);
    expect(() => assertNotRealHostInTests(real, envOf({ NODE_ENV: "production", VOICE_TEST_GUARD: "1" }))).toThrow(/test environment/);
    expect(() => assertNotRealHostInTests("http://127.0.0.1:4010", envOf({ NODE_ENV: "test" }))).not.toThrow();
    expect(() => assertNotRealHostInTests("http://LOCALHOST:4010", envOf({ VOICE_TEST_GUARD: "1" }))).not.toThrow();
  });

  it("does not interfere outside tests", () => {
    expect(() => assertNotRealHostInTests(real, envOf({ NODE_ENV: "production" }))).not.toThrow();
  });

  it("stops the parser before any request when the real host is configured in a test", async () => {
    const fake = vi.fn() as unknown as typeof fetch;
    const parser = new GeminiParser({ apiKey: "k", model: "m", baseUrl: real }, fake, envOf({ NODE_ENV: "test" }));
    await expect(parser.parse(TRANSCRIPT)).rejects.toThrow(/test environment/);
    expect(fake).not.toHaveBeenCalled();
  });
});

describe("a round trip against the fake Gemini server", () => {
  const port = 4021;
  let child: ChildProcess;

  beforeAll(async () => {
    child = spawn(process.execPath, [path.resolve(__dirname, "../e2e/support/fake-gemini.mjs")], { env: { ...process.env, FAKE_GEMINI_PORT: String(port) }, stdio: "ignore" });
    for (let i = 0; i < 50; i += 1) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/__health`)).ok) return;
      } catch {
        // not up yet
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("the fake Gemini server did not start");
  }, 15_000);

  afterAll(() => {
    child?.kill();
  });

  it("returns the scripted draft list for a clear sentence and sends exactly the request body", async () => {
    const parser = new GeminiParser({ apiKey: KEY_SENTINEL, model: "test-model", baseUrl: `http://127.0.0.1:${port}` }, fetch, envOf({ NODE_ENV: "test" }));
    const raw = await parser.parse(TRANSCRIPT);
    expect(raw).toEqual({
      store: "Al Madina Medical",
      items: [
        { name: "Panadol", quantity: 20, unit: "strips" },
        { name: "Brufen", quantity: 10, unit: "strips" },
      ],
      unreadable: [],
    });
    const recorded = (await (await fetch(`http://127.0.0.1:${port}/__requests`)).json()) as Array<{ keyOk: boolean; keyInUrl: boolean; body: unknown }>;
    const last = recorded[recorded.length - 1];
    expect(last.keyOk).toBe(true);
    expect(last.keyInUrl).toBe(false);
    expect(last.body).toEqual(buildGeminiRequest(TRANSCRIPT));
  });
});
