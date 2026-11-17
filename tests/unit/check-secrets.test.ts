import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// The lint step runs scripts/check-secrets.mjs. Module 008 reads the Gemini key in exactly one file; this test runs
// the real script against a temporary tree (outside git, so only the source checks run) and proves that the one file
// is allowed and every other use of the name, the service-role name and a JWT-like value are still refused.

const script = path.resolve(__dirname, "../../scripts/check-secrets.mjs");
const dirs: string[] = [];

function runOn(files: Record<string, string>): { code: number | null; output: string } {
  const root = mkdtempSync(path.join(tmpdir(), "check-secrets-"));
  dirs.push(root);
  for (const [name, text] of Object.entries(files)) {
    const full = path.join(root, name);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("scripts/check-secrets.mjs", () => {
  it("passes a clean source tree", () => {
    const run = runOn({ "src/lib/a.ts": "export const a = 1;\n" });
    expect(run.code).toBe(0);
    expect(run.output).toContain("Secrets check passed.");
  });

  it("allows the Gemini key name in src/lib/voice/gemini.ts only", () => {
    const run = runOn({
      "src/lib/voice/gemini.ts": "const key = process.env.GEMINI_API_KEY;\nexport { key };\n",
      "src/lib/a.ts": "export const a = 1;\n",
    });
    expect(run.code).toBe(0);
  });

  it("refuses the Gemini key name in any other file under src/", () => {
    for (const other of ["src/lib/voice/service.ts", "src/app/api/voice/parse/route.ts", "src/components/voice/Panel.tsx", "src/lib/gemini.ts"]) {
      const run = runOn({ [other]: "const key = process.env.GEMINI_API_KEY;\n" });
      expect(run.code, other).toBe(1);
      expect(run.output, other).toContain("references a server-only secret name");
    }
  });

  it("refuses the service-role name everywhere, including in the allowed Gemini file", () => {
    expect(runOn({ "src/lib/a.ts": "process.env.SUPABASE_SERVICE_ROLE_KEY;\n" }).code).toBe(1);
    expect(runOn({ "src/lib/voice/gemini.ts": "process.env.SUPABASE_SERVICE_ROLE_KEY;\n" }).code).toBe(1);
  });

  it("refuses a JWT-like value, even in the allowed Gemini file", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV";
    expect(runOn({ "src/lib/voice/gemini.ts": `const k = "${jwt}";\n` }).code).toBe(1);
  });
});
