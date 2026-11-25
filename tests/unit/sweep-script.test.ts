import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkTarget, countByLabel, isTestEmail, labelOf, parseArgs, parseEnv, pickCandidates, projectRefOf } from "../../scripts/sweep-lib";

// The pure rules of the leftover sweep (Module 011, T050). The script itself is not run by the tests: it deletes data on the TEST
// project, and only runs when the owner says so.

const NOW = new Date("2026-11-24T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

describe("the project it may run on", () => {
  it("reads the project reference of a Supabase address", () => {
    expect(projectRefOf("https://abcdefghij1234.supabase.co")).toBe("abcdefghij1234");
    expect(projectRefOf("https://abcdefghij1234.supabase.co/rest/v1")).toBe("abcdefghij1234");
    for (const bad of ["", null, undefined, "not a url", "https://example.com", "https://short.supabase.co", "http://localhost:54321"]) expect(projectRefOf(bad as string)).toBeNull();
  });

  it("refuses without a test address or a key, and refuses the project of the app itself", () => {
    const test = "https://testprojectref123.supabase.co";
    const app = "https://appprojectref1234.supabase.co";
    expect(checkTarget({ testUrl: test, serviceKey: "k", appUrl: app })).toEqual({ ok: true, ref: "testprojectref123" });
    expect(checkTarget({ testUrl: "", serviceKey: "k" })).toMatchObject({ ok: false });
    expect(checkTarget({ testUrl: test, serviceKey: "" })).toMatchObject({ ok: false });
    expect(checkTarget({ testUrl: "https://example.com", serviceKey: "k" })).toMatchObject({ ok: false });
    const same = checkTarget({ testUrl: app, serviceKey: "k", appUrl: app });
    expect(same).toMatchObject({ ok: false });
    expect((same as { reason: string }).reason).toContain("same project");
    expect(checkTarget({ testUrl: test, serviceKey: "k", appUrl: undefined })).toMatchObject({ ok: true });
  });

  it("reads env files without printing or keeping anything else", () => {
    const env = parseEnv('# a comment\nSUPABASE_TEST_URL="https://x.supabase.co"\nSUPABASE_TEST_SERVICE_ROLE_KEY = abc\n\nBROKEN LINE\n#COMMENTED=1\n');
    expect(env).toEqual({ SUPABASE_TEST_URL: "https://x.supabase.co", SUPABASE_TEST_SERVICE_ROLE_KEY: "abc" });
  });
});

describe("which businesses may be swept", () => {
  const users = new Map([
    ["u-test", "e2e-fresh-1a2b3c4d@example.test"],
    ["u-test2", "reports-scale-0f0f0f0f@example.test"],
    ["u-owner", "owner@gmail.com"],
    ["u-mixed", "e2e-12345678@example.test"],
  ]);
  const businesses = [
    { id: "b1", name: "e2e-fresh business", created_at: minutesAgo(600) },
    { id: "b2", name: "reports-scale business", created_at: minutesAgo(120) },
    { id: "b3", name: "My Pharmacy business", created_at: minutesAgo(9000) },
    { id: "b4", name: "e2e business", created_at: minutesAgo(5) },
    { id: "b5", name: "e2e business", created_at: minutesAgo(900) },
    { id: "b6", name: "no users business", created_at: minutesAgo(900) },
    { id: "b7", name: "Not made by a test", created_at: minutesAgo(900) },
    { id: "b8", name: "e2e-fresh business", created_at: minutesAgo(900) }, // a leftover: its user was deleted, the business stayed
    { id: "b9", name: "Al Shifa business", created_at: minutesAgo(900) }, // a name a person typed (capitals, no user): never swept
  ];
  const usersOfBusiness = new Map([
    ["b1", ["u-test"]],
    ["b2", ["u-test2"]],
    ["b3", ["u-owner"]],
    ["b4", ["u-mixed"]],
    ["b5", ["u-mixed", "u-owner"]], // one real user: never swept
    ["b7", ["u-test"]],
  ]);

  it("picks only businesses named for a test whose every user has a test address, and that are old enough", () => {
    const picked = pickCandidates({ businesses, usersOfBusiness, emailOfUser: users, now: NOW, minAgeMinutes: 30 });
    expect(picked.map((c) => c.businessId)).toEqual(["b1", "b2", "b8"]);
    expect(picked.map((c) => c.label)).toEqual(["e2e-fresh", "reports-scale", "e2e-fresh"]);
  });

  it("never picks the owner's business, a business with a real user, a business with no user, or one younger than the limit", () => {
    const picked = pickCandidates({ businesses, usersOfBusiness, emailOfUser: users, now: NOW, minAgeMinutes: 30 }).map((c) => c.businessId);
    for (const never of ["b3", "b4", "b5", "b6", "b7", "b9"]) expect(picked).not.toContain(never);
    const strict = pickCandidates({ businesses, usersOfBusiness, emailOfUser: users, now: NOW, minAgeMinutes: 500 }).map((c) => c.businessId);
    expect(strict).toEqual(["b1", "b8"]);
  });

  it("recognises a test address and a test business name exactly", () => {
    expect(isTestEmail("e2e-1a2b3c4d@example.test")).toBe(true);
    expect(isTestEmail("reports-scale-0f0f0f0f@example.test")).toBe(true);
    for (const bad of ["owner@example.test", "e2e-1a2b3c4d@example.com", "e2e-1a2b3c4@example.test", "someone@gmail.com", "", null, undefined]) expect(isTestEmail(bad as string)).toBe(false);
    expect(labelOf("e2e-fresh business")).toBe("e2e-fresh");
    for (const bad of ["E2E business", "Al Shifa business", "My Pharmacy business", "business", "e2e business 2", "e2e", "-e2e business", "e2e- business"]) expect(labelOf(bad), bad).toBeNull();
  });

  it("counts by label for the report", () => {
    const picked = pickCandidates({ businesses, usersOfBusiness, emailOfUser: users, now: NOW, minAgeMinutes: 30 });
    expect(countByLabel([...picked, ...picked])).toEqual([
      { label: "e2e-fresh", count: 4 },
      { label: "reports-scale", count: 2 },
    ]);
  });
});

describe("its options", () => {
  it("is a dry run by default and only knows its three options", () => {
    expect(parseArgs([])).toEqual({ del: false, minAgeMinutes: 30, limit: null });
    expect(parseArgs(["--delete", "--min-age-minutes=60", "--limit=20"])).toEqual({ del: true, minAgeMinutes: 60, limit: 20 });
    for (const bad of ["--force", "--delete=1", "--limit=0", "--min-age-minutes=x", "all"]) expect(parseArgs([bad]), bad).toHaveProperty("error");
  });
});

describe("the script file", () => {
  const script = readFileSync(path.join(process.cwd(), "scripts", "sweep-test-project.mjs"), "utf8");

  it("is a dry run unless --delete is given, and checks the target before it connects", () => {
    expect(script.indexOf("checkTarget(")).toBeGreaterThan(-1);
    expect(script.indexOf("checkTarget(")).toBeLessThan(script.indexOf("createClient("));
    expect(script).toMatch(/if \(!args\.del\)/);
    expect(script).not.toMatch(/process\.exit\(/); // a hard exit crashes Node on Windows while connections close
  });

  it("never prints a key or an email address", () => {
    const printed = [...script.matchAll(/console\.(?:log|error)\(([^;]*)\);/g)].map((m) => m[1]!).join("\n");
    expect(printed).not.toMatch(/SERVICE_ROLE|serviceKey|\.email|emailOfUser|password/i);
  });

  it("is wired to an npm script, not to a package", () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["test:sweep"]).toBe("node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/sweep-test-project.mjs");
  });
});
