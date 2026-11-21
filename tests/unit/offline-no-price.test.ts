import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static guards for the offline module (Module 009, task T066): the device code, the backup code, the offline screens, the
// two new routes and the service worker must not touch prices, balances, invoices or secrets, must not keep data in
// localStorage or sessionStorage, and every device fetch must keep a 401 from navigating the person away.

const ROOT = process.cwd();

function files(dir: string, extensions = [".ts", ".tsx", ".js", ".mjs"]): string[] {
  const full = path.join(ROOT, dir);
  let entries: string[] = [];
  try {
    entries = readdirSync(full);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const p = path.join(full, entry);
    if (statSync(p).isDirectory()) out.push(...files(path.join(dir, entry), extensions));
    else if (extensions.some((e) => entry.endsWith(e))) out.push(path.join(dir, entry));
  }
  return out;
}

function code(file: string): string {
  const source = readFileSync(path.join(ROOT, file), "utf8");
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const OFFLINE_SOURCES = [
  ...files("src/lib/device"),
  ...files("src/lib/backup"),
  ...files("src/components/offline"),
  ...files("src/app/api/ping"),
  ...files("src/app/api/backup"),
  "src/app/offline/page.tsx",
  "src/lib/orders/save-transport.ts",
  "public/sw.js",
];

const FORBIDDEN = /purchase_price|\bmrp\b|\bcost\b|\bmargin\b|\bprofit\b|\bbalance\b|invoice|snapshot_|ledger|payment/i;
// The shell only NAMES the areas that need the internet ("Invoices", "Store accounts") and the backup file code lists the words a
// backup must never contain (to refuse a file that has them); the backup screen tells the supplier what a backup never holds; none of them reads or writes any such data.
const NAMES_ONLY = new Set([path.join("src", "lib", "device", "shell-route.ts"), path.join("src", "lib", "backup", "file.ts"), path.join("src", "components", "offline", "BackupSection.tsx")]);

describe("offline module static guards", () => {
  it("finds the files it is meant to guard", () => {
    expect(OFFLINE_SOURCES.length).toBeGreaterThan(10);
  });

  it("mentions no purchase price, MRP, cost, margin, profit, balance, invoice, ledger or payment", () => {
    const offenders = OFFLINE_SOURCES.filter((f) => !NAMES_ONLY.has(path.normalize(f)) && FORBIDDEN.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it("keeps no data in localStorage or sessionStorage", () => {
    const offenders = OFFLINE_SOURCES.filter((f) => /localStorage|sessionStorage/.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it("never mentions a service-role key or any secret in browser code", () => {
    const offenders = OFFLINE_SOURCES.filter((f) => !NAMES_ONLY.has(path.normalize(f)) && /service_role|SERVICE_ROLE|GEMINI|secret/i.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it("makes every fetchJson call in the device code keep a 401 from navigating away", () => {
    const offenders: string[] = [];
    for (const f of files("src/lib/device").filter((x) => !x.endsWith("runtime.ts"))) {
      const c = code(f);
      for (const m of c.matchAll(/fetchJson\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g)) {
        if (!/onUnauthorized\s*:\s*"event"/.test(m[1] ?? "")) offenders.push(`${f}: ${m[0].slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not let the service worker handle or keep any API answer or authenticated page", () => {
    const c = code("public/sw.js");
    expect(c.match(/\/api\//g)?.length).toBe(1);
    expect(c).toContain('startsWith("/api/")');
    expect((c.match(/\.put\(/g) ?? []).length).toBe(2);
  });
});
