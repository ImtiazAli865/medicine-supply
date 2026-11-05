import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.test.local" });

const port = Number(process.env.PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

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
  webServer: {
    // A production build: fast and close to the real app (a dev server compiles each page on its
    // first visit, which makes sign-in tests slow). It must NOT reuse a running dev server, because
    // that one may be connected to a different Supabase project. Stop `npm run dev` before E2E.
    command: "npm run build && npm run start",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 300_000,
    // The app under test talks to the dedicated TEST Supabase project.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.SUPABASE_TEST_URL ?? "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.SUPABASE_TEST_ANON_KEY ?? "",
    },
  },
});
