import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/ping/route";
import { config } from "@/proxy";

describe("GET /api/ping", () => {
  it("answers 200 with { ok: true } and is never cached", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("needs no cookies, session or database", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/api/ping/route.ts"), "utf8");
    const code = source.replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/supabase|cookies|requireBusinessUser|loadBusinessContext/i);
  });

  it("is skipped by the session proxy so it never waits for the auth server", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test("/api/ping")).toBe(false);
    expect(matcher.test("/api/orders")).toBe(true);
    expect(matcher.test("/api/ping-other")).toBe(true);
    expect(matcher.test("/orders/new")).toBe(true);
  });
});
