import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.test.local" });

const port = Number(process.env.PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;
const fakeGeminiPort = Number(process.env.FAKE_GEMINI_PORT ?? 4010);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 360, height: 800 } },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      // Module 008: a tiny fake of the Gemini endpoint, so no browser test needs a real key or a connection to Google.
      command: "node tests/e2e/support/fake-gemini.mjs",
      url: `http://127.0.0.1:${fakeGeminiPort}/__health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { FAKE_GEMINI_PORT: String(fakeGeminiPort) },
    },
    {
      // A production build: fast and close to the real app (a dev server compiles each page on its
      // first visit, which makes sign-in tests slow). It must NOT reuse a running dev server, because
      // that one may be connected to a different Supabase project. Stop `npm run dev` before E2E.
      command: "npm run build && npm run start",
      url: baseURL,
      reuseExistingServer: false,
      timeout: 300_000,
      // The app under test talks to the dedicated TEST Supabase project and to the fake Gemini (placeholder key and
      // model; VOICE_TEST_GUARD makes the Gemini client refuse the real Google host).
      env: {
        NEXT_PUBLIC_SUPABASE_URL: process.env.SUPABASE_TEST_URL ?? "",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.SUPABASE_TEST_ANON_KEY ?? "",
        GEMINI_API_KEY: "test-key-sentinel-do-not-use",
        GEMINI_MODEL: "test-model",
        GEMINI_API_BASE_URL: `http://127.0.0.1:${fakeGeminiPort}`,
        VOICE_TEST_GUARD: "1",
      },
    },
  ],
});
