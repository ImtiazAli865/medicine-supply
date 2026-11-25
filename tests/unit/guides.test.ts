import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Module 011 (T051): the four guides and the README exist, say what is true, and point only at files that exist.

const ROOT = process.cwd();
const GUIDES = ["supabase-setup.md", "offline-and-sync.md", "backup-and-restore.md", "deployment.md"];
const DOCS = ["README.md", ...GUIDES.map((g) => `guides/${g}`)];
const text = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

describe("the guides", () => {
  it("exist, each with a title and real content", () => {
    for (const guide of GUIDES) {
      const file = path.join(ROOT, "guides", guide);
      expect(existsSync(file), guide).toBe(true);
      const body = readFileSync(file, "utf8");
      expect(body.startsWith("# "), guide).toBe(true);
      expect(body.length, guide).toBeGreaterThan(1500);
    }
  });

  it("lists every migration of the folder in order in the Supabase setup guide, and explains 0009 and 0010", () => {
    const files = readdirSync(path.join(ROOT, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    const body = text("guides/supabase-setup.md");
    const positions = files.map((f) => body.indexOf(`\`${f}\``));
    expect(positions.filter((p) => p < 0), "a migration missing from the guide").toEqual([]);
    expect([...positions].sort((a, b) => a - b), "the migrations are listed in order").toEqual(positions);
    expect(body).toMatch(/0009/);
    expect(body).toMatch(/0010/);
    expect(body).toMatch(/not in this repository/i);
    // nothing is promised that the folder does not have
    expect(body).not.toMatch(/`0009_[a-z_]+\.sql`|`0010_[a-z_]+\.sql`/);
  });

  it("tells how to set up the password reset email, with the exact link of the template", () => {
    const body = text("guides/supabase-setup.md");
    expect(body).toContain("{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery");
    expect(body).toMatch(/Redirect URLs/);
    expect(body).toMatch(/SMTP/);
  });

  it("states that the app is not deployed in the deployment guide", () => {
    expect(text("guides/deployment.md")).toMatch(/Nothing is deployed/);
  });

  it("points only at files that exist: markdown links and the paths written in backticks", () => {
    const missing: string[] = [];
    for (const doc of DOCS) {
      const body = text(doc);
      const dir = path.dirname(path.join(ROOT, doc));
      for (const m of body.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = m[1]!.split("#")[0]!;
        if (target === "" || /^[a-z]+:/i.test(target)) continue;
        if (!existsSync(path.resolve(dir, target))) missing.push(`${doc}: link ${m[1]}`);
      }
      for (const m of body.matchAll(/`((?:src|tests|supabase|guides|specs|scripts|docs)\/[A-Za-z0-9_./\[\]()-]+?)`/g)) {
        const target = m[1]!;
        if (/[*<{]/.test(target) || target.endsWith("/")) continue;
        if (!existsSync(path.join(ROOT, target))) missing.push(`${doc}: path ${target}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("holds no real key, token or password, and no Roman Urdu", () => {
    const stopWords = /\b(hai|hain|nahi|kya|karo|kiya|mera|mujhe|aapka|apna|haan|abhi|chahiye|hoga|liye)\b/i;
    const keyPatterns = [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /sbp_[a-z0-9]{20,}/, /sb_secret_[A-Za-z0-9_-]{10,}/, /AIza[0-9A-Za-z_-]{30,}/, /service_role["']?\s*[:=]\s*["'][A-Za-z0-9._-]{30,}/];
    const problems: string[] = [];
    for (const doc of DOCS) {
      const body = text(doc);
      if (stopWords.test(body)) problems.push(`${doc}: a Roman Urdu word`);
      for (const pattern of keyPatterns) if (pattern.test(body)) problems.push(`${doc}: looks like a real key (${pattern})`);
    }
    expect(problems).toEqual([]);
  });
});
