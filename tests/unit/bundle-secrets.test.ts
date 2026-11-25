import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Security review (Module 011, T037): no secret is in the code that is sent to the browser. When a production build exists
// (`.next/static`), every file the browser can download is searched for the service-role key (its pattern, and the values of the
// project's own secret variables) and for the names of keys that belong only on the server. The public Supabase address and the
// anonymous key are meant to be in the bundle. Secret values are read at test time and are never printed.

const ROOT = process.cwd();
const STATIC_DIR = path.join(ROOT, ".next", "static");
const PUBLIC_DIR = path.join(ROOT, "public");
const hasBuild = existsSync(STATIC_DIR);
if (!hasBuild) console.warn("bundle-secrets: there is no production build (.next/static), so the browser files were not searched. Run `npm run build` first.");

function filesOf(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesOf(full));
    else if (/\.(js|mjs|css|html|json|map|txt)$/.test(entry)) out.push(full);
  }
  return out;
}

/** The values of the server-only variables of the project's env files: the ones that look like a key, secret, token or password. */
function secretValues(): Array<{ name: string; value: string }> {
  const found: Array<{ name: string; value: string }> = [];
  for (const file of [".env.local", ".env.test.local", ".env"]) {
    const p = path.join(ROOT, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const [, name, rawValue] = m as unknown as [string, string, string];
      const value = rawValue.replace(/^["']|["']$/g, "");
      if (name.startsWith("NEXT_PUBLIC_")) continue; // meant to be public
      if (/ANON|PUBLISHABLE/i.test(name)) continue; // the anonymous key is public by design
      if (!/KEY|SECRET|TOKEN|PASSWORD|SERVICE/i.test(name)) continue;
      if (value.length >= 12) found.push({ name, value });
    }
  }
  return found;
}

/** True when the text holds a token whose payload says role = service_role. */
function hasServiceRoleToken(text: string): boolean {
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.([A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1]!, "base64url").toString("utf8")) as { role?: string };
      if (payload.role === "service_role") return true;
    } catch {
      // not a token
    }
  }
  return false;
}

const token = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ iss: "supabase", role })).toString("base64url")}.c2lnbmF0dXJlLXNpZ25hdHVyZQ`;

describe("the secret scan itself", () => {
  it("finds a planted service-role key and lets the anonymous key through", () => {
    expect(hasServiceRoleToken(`var a="${token("service_role")}";`)).toBe(true);
    expect(hasServiceRoleToken(`var a="${token("anon")}";`)).toBe(false);
    expect(hasServiceRoleToken("no key here")).toBe(false);
  });
});

const suite = hasBuild ? describe : describe.skip;

suite("the files the browser can download", () => {
  const files = [...filesOf(STATIC_DIR), ...filesOf(PUBLIC_DIR)];
  const texts = files.map((f) => ({ f, text: readFileSync(f, "utf8") }));

  it("finds the built files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("contains no key that decodes to the service role", () => {
    expect(texts.filter(({ text }) => hasServiceRoleToken(text)).map(({ f }) => path.relative(ROOT, f))).toEqual([]);
  });

  it("contains the value of no secret variable of the project", () => {
    const secrets = secretValues();
    const offenders: string[] = [];
    for (const { name, value } of secrets) {
      for (const { f, text } of texts) if (text.includes(value)) offenders.push(`${name} in ${path.relative(ROOT, f)}`);
    }
    console.info(`bundle-secrets: searched ${files.length} files for ${secrets.length} secret values (names: ${secrets.map((s) => s.name).join(", ") || "none"}); none was printed.`);
    expect(offenders).toEqual([]);
  });

  it("names no server-only key anywhere in the browser files", () => {
    const offenders: string[] = [];
    for (const { f, text } of texts) {
      for (const word of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_TEST_SERVICE_ROLE_KEY", "service_role", "GEMINI_API_KEY"]) {
        if (text.includes(word)) offenders.push(`${word} in ${path.relative(ROOT, f)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
