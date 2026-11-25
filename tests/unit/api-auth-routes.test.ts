import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Security review (Module 011, T034): every route of the app's API must be reached only by a signed-in business user. Each
// exported handler of every `src/app/api/**/route.ts` calls `requireBusinessUser(`, which answers 401 without a session and
// gives the handler the signed-in client (so row level security applies). The only exception is on the list below, with its reason.

const ROOT = process.cwd();
const API = path.join(ROOT, "src", "app", "api");

/** Routes that do not need a session, each with the reason. A new route is never added here without a reason a person has read. */
const ALLOWED_WITHOUT_SESSION: Record<string, string> = {
  "ping/route.ts": "connectivity check: answers an empty 200 and holds no data",
};

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

/** The exported handlers (GET, POST, ...) of a route file and the source of each one. */
function handlers(source: string): Array<{ method: string; body: string }> {
  const found: Array<{ method: string; index: number }> = [];
  for (const m of source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) found.push({ method: m[1]!, index: m.index! });
  for (const m of source.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) found.push({ method: m[1]!, index: m.index! });
  found.sort((a, b) => a.index - b.index);
  return found.map((h, i) => ({ method: h.method, body: source.slice(h.index, found[i + 1]?.index ?? source.length) }));
}

const files = routeFiles(API);
const relative = (file: string) => path.relative(API, file).split(path.sep).join("/");

describe("every API route requires a signed-in business user", () => {
  it("finds the routes it is meant to check", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("calls requireBusinessUser in every exported handler of every route, except the listed ones", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(file);
      if (rel in ALLOWED_WITHOUT_SESSION) continue;
      const found = handlers(readFileSync(file, "utf8"));
      if (found.length === 0) offenders.push(`${rel}: no exported handler found`);
      for (const h of found) if (!/requireBusinessUser\s*\(/.test(h.body)) offenders.push(`${rel}: ${h.method} does not call requireBusinessUser`);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the list of routes without a session short, and every one of them has a file and a reason", () => {
    expect(Object.keys(ALLOWED_WITHOUT_SESSION)).toEqual(["ping/route.ts"]);
    for (const [rel, reason] of Object.entries(ALLOWED_WITHOUT_SESSION)) {
      expect(files.map(relative), rel).toContain(rel);
      expect(reason.length, rel).toBeGreaterThan(10);
    }
  });

  it("proves the allowed route holds no data: it reads no table and no cookie", () => {
    const source = readFileSync(path.join(API, "ping", "route.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(/supabase|createClient|cookies|headers\(|\.from\(|\.rpc\(/i);
  });

  it("never reads the service-role key in any route", () => {
    const offenders = files.filter((f) => /SERVICE_ROLE|service_role/i.test(readFileSync(f, "utf8"))).map(relative);
    expect(offenders).toEqual([]);
  });

  it("prints each route with its decision (for the security review)", () => {
    const lines = files.map(relative).sort().map((rel) => `${rel in ALLOWED_WITHOUT_SESSION ? "open  " : "signed "}${rel}`);
    expect(lines.length).toBe(files.length);
    console.info(`API routes (${files.length}):\n${lines.join("\n")}`);
  });
});
