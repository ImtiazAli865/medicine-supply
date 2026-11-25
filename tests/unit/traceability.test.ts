import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Module 011 (T033): the table in specs/011-hardening-offline-payments/traceability.md maps every test item of the master prompt's
// Section 17 (31) and every final acceptance criterion (16) to the tests that check it, or says plainly why not.

const ROOT = process.cwd();
const TABLE = path.join(ROOT, "specs", "011-hardening-offline-payments", "traceability.md");
const STATUSES = ["covered", "partly covered", "dropped with voice", "limitation"] as const;
type Status = (typeof STATUSES)[number];

interface Row {
  id: string;
  item: string;
  status: string;
  detail: string;
  files: string[];
}

function rows(): Row[] {
  const out: Row[] = [];
  for (const line of readFileSync(TABLE, "utf8").split(/\r?\n/)) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 6 || !/^(S17|AC)\.\d+$/.test(cells[1] ?? "")) continue;
    const detail = cells.slice(4, cells.length - 1).join("|");
    out.push({ id: cells[1]!, item: cells[2] ?? "", status: cells[3] ?? "", detail, files: [...detail.matchAll(/`([^`\s]+\.(?:ts|tsx|md|mjs|json|sql))`/g)].map((m) => m[1]!) });
  }
  return out;
}

describe("the traceability table of the master prompt", () => {
  const table = rows();

  it("has exactly 47 rows: 31 test items and 16 acceptance criteria, each once", () => {
    expect(table).toHaveLength(47);
    expect(table.filter((r) => r.id.startsWith("S17.")).map((r) => r.id)).toEqual(Array.from({ length: 31 }, (_, i) => `S17.${i + 1}`));
    expect(table.filter((r) => r.id.startsWith("AC.")).map((r) => r.id)).toEqual(Array.from({ length: 16 }, (_, i) => `AC.${i + 1}`));
  });

  it("uses only the four statuses", () => {
    expect(table.filter((r) => !(STATUSES as readonly string[]).includes(r.status)).map((r) => `${r.id}: ${r.status}`)).toEqual([]);
  });

  it("names at least one test file for every covered and partly covered row, and every named file exists", () => {
    const problems: string[] = [];
    for (const r of table) {
      if (r.status === "covered" || r.status === "partly covered") {
        if (r.files.length === 0) problems.push(`${r.id}: names no file`);
        if (!r.files.some((f) => f.startsWith("tests/"))) problems.push(`${r.id}: names no test file`);
      }
      for (const f of r.files) if (!existsSync(path.join(ROOT, f))) problems.push(`${r.id}: ${f} does not exist`);
    }
    expect(problems).toEqual([]);
  });

  it("gives a reason for every row that is dropped, a limitation or only partly covered", () => {
    const short = table.filter((r) => r.status !== "covered" && r.detail.replace(/`[^`]*`/g, "").trim().length < 40).map((r) => r.id);
    expect(short).toEqual([]);
  });

  it("has a summary line that matches the rows", () => {
    const counts: Record<Status, number> = { covered: 0, "partly covered": 0, "dropped with voice": 0, limitation: 0 };
    for (const r of table) counts[r.status as Status] += 1;
    const text = readFileSync(TABLE, "utf8");
    const expected = `Summary: covered ${counts.covered} · partly covered ${counts["partly covered"]} · dropped with voice ${counts["dropped with voice"]} · limitation ${counts.limitation}`;
    expect(text).toContain(expected);
    console.info(`Traceability: ${expected.replace("Summary: ", "")} (${table.length} rows)`);
  });

  it("marks as dropped only the two items that are about the AI provider or voice recognition", () => {
    expect(table.filter((r) => r.status === "dropped with voice").map((r) => r.id)).toEqual(["S17.5", "S17.30"]);
  });
});
