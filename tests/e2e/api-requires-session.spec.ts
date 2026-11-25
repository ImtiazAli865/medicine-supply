import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { hasTestEnv, SKIP_REASON } from "../helpers/supabase-test";
import { expect, test } from "./fixtures";

// Security review (Module 011, T036): the RUNNING app answers 401 to every method of every API route when there is no session.
// The list of routes and methods is read from the source, so a new route is covered without editing this test. No cookie, no
// token: a visitor who is not signed in.

const API = path.join(process.cwd(), "src", "app", "api");

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

function methodsOf(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) found.add(m[1]!);
  for (const m of source.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) found.add(m[1]!);
  return [...found];
}

/** `accounts/[storeId]/payments/route.ts` becomes `/api/accounts/<uuid>/payments`. */
function urlOf(file: string): string {
  const rel = path.relative(API, path.dirname(file)).split(path.sep).join("/");
  return `/api/${rel.replace(/\[[^\]]+\]/g, () => randomUUID())}`;
}

const routes = routeFiles(API)
  .map((file) => ({ url: urlOf(file), rel: path.relative(API, file).split(path.sep).join("/"), methods: methodsOf(readFileSync(file, "utf8")) }))
  .filter((r) => r.rel !== "ping/route.ts");

test.describe("the API without a session", () => {
  test.skip(!hasTestEnv, SKIP_REASON);
  test.setTimeout(180_000);

  test("finds the routes it is meant to check", () => {
    expect(routes.length).toBeGreaterThan(40);
    expect(routes.flatMap((r) => r.methods).length).toBeGreaterThan(55);
  });

  test("answers 401 unauthenticated to every method of every route, and returns no data", async ({ request }) => {
    const refused: string[] = [];
    let checked = 0;
    for (const route of routes) {
      for (const method of route.methods) {
        const response = await request.fetch(route.url, { method, data: method === "GET" || method === "DELETE" ? undefined : {}, maxRedirects: 0 });
        checked += 1;
        const text = await response.text();
        let code: string | undefined;
        try {
          code = (JSON.parse(text) as { code?: string }).code;
        } catch {
          code = undefined;
        }
        if (response.status() !== 401 || code !== "unauthenticated") refused.push(`${method} ${route.rel}: ${response.status()} ${text.slice(0, 80)}`);
      }
    }
    expect(checked).toBeGreaterThan(55);
    expect(refused).toEqual([]);
  });

  test("the connectivity check is the only route that answers without a session, and it holds no data", async ({ request }) => {
    const response = await request.get("/api/ping");
    expect(response.status()).toBe(200);
    expect((await response.text()).length).toBeLessThan(40);
  });
});
