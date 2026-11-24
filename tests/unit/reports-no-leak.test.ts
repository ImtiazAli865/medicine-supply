import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Reports are internal (spec FR-018, FR-019, plan D11). Nothing customer-facing, nothing on the device and nothing in
// the backup may import or name the report code, and the report code itself never touches a secret key or any
// browser storage. A reverse import (the reports using the market list's CSV helper or the account functions) is fine.

const ROOT = process.cwd();

function files(target: string): string[] {
  const full = path.join(ROOT, target);
  let stat;
  try {
    stat = statSync(full);
  } catch {
    return [];
  }
  if (stat.isFile()) return [target];
  return readdirSync(full).flatMap((name) => files(path.join(target, name)));
}

const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

// Any way of reaching the report code or its routes.
const REPORT_REFERENCE = /@\/(lib|components)\/reports|\/api\/reports|["'`]\/reports|lib\/reports|components\/reports/;

const PROTECTED = [
  "src/lib/invoices",
  "src/components/invoices",
  "src/lib/accounts",
  "src/components/accounts",
  "src/lib/market",
  "src/components/market",
  "src/lib/orders",
  "src/components/orders",
  "src/lib/pending",
  "src/components/pending",
  "src/lib/device",
  "src/lib/backup",
  "src/components/offline",
  "src/app/api/backup",
  "src/app/api/invoices",
  "src/app/api/accounts",
  "src/app/api/market-list",
  "src/app/api/orders",
  "src/app/(app)/invoices",
  "src/app/(app)/accounts",
  "src/app/(app)/market-list",
  "src/app/(app)/orders",
  "src/app/offline",
  "public/sw.js",
];

// The one allowed mention: the offline shell names Reports as an area that needs the internet.
const ALLOWED_LINE = { file: path.join("src", "lib", "device", "shell-route.ts"), line: '["/reports", "Reports"],' };

describe("reports stay internal", () => {
  const protectedFiles = PROTECTED.flatMap(files);

  it("finds the files it is meant to guard", () => {
    expect(protectedFiles.length).toBeGreaterThan(100);
    expect(protectedFiles).toContain(path.join("src", "lib", "device", "shell-route.ts"));
    expect(protectedFiles).toContain("public/sw.js");
  });

  it("lets no invoice, account, market list, order, pending, offline, backup or service worker file reach the report code", () => {
    const offenders: string[] = [];
    for (const file of protectedFiles) {
      const normal = path.normalize(file);
      const lines = read(file).split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!REPORT_REFERENCE.test(line)) return;
        if (normal === ALLOWED_LINE.file && line.trim() === ALLOWED_LINE.line) return;
        offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 80)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("keeps exactly one allowed mention in the offline shell", () => {
    const text = read("src/lib/device/shell-route.ts");
    expect(text.split("\n").filter((l) => REPORT_REFERENCE.test(l)).map((l) => l.trim())).toEqual([ALLOWED_LINE.line]);
  });
});

describe("the report code itself", () => {
  const own = ["src/lib/reports", "src/components/reports", "src/app/(app)/reports", "src/app/api/reports"].flatMap(files);

  it("finds the report files", () => {
    expect(own.length).toBeGreaterThan(30);
  });

  it("never names a service-role key or any secret", () => {
    const offenders = own.filter((f) => /service_role|SERVICE_ROLE|GEMINI|api[_-]?key/i.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("keeps nothing in browser storage or on the device", () => {
    const offenders = own.filter((f) => /localStorage|sessionStorage|indexedDB|caches\.open|serviceWorker/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("reaches the data only through the signed-in user's client (never a server-only admin client)", () => {
    const offenders = own.filter((f) => /createClient\s*\(\s*process\.env|auth\.admin|supabase-admin|createServiceClient/i.test(read(f)));
    expect(offenders).toEqual([]);
  });
});
