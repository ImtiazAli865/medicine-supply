import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// SC-007 of Module 008: nothing new may read, select, send or show a purchase price, MRP, cost, margin, profit, balance,
// invoice value or price snapshot. This reads the new source files (comments removed, so only code and text count).

const FILES = [
  "src/lib/orders/fast-types.ts",
  "src/lib/orders/fast-search.ts",
  "src/lib/orders/fast-usual.ts",
  "src/lib/orders/fast-list.ts",
  "src/lib/orders/fast-repository.ts",
  "src/lib/validation/fast-order.ts",
  "src/app/api/orders/medicines/route.ts",
  "src/app/api/orders/usual/route.ts",
  "src/app/api/orders/repeat/route.ts",
  "src/components/orders/FastAdd.tsx",
  "src/components/orders/UsualMedicines.tsx",
  "src/components/orders/RepeatLastOrder.tsx",
  "src/components/orders/UndoBar.tsx",
  "src/components/orders/TypedLineForm.tsx",
  "src/lib/hooks/useMedicineList.ts",
  "src/lib/hooks/useUsualMedicines.ts",
  "src/lib/hooks/useInactiveLines.ts",
];

const FORBIDDEN = /purchase|\bmrp\b|\bcost\b|margin|profit|balance|snapshot|invoice|unit_gross/i;

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\w"'`])\/\/.*$/gm, "$1");
}

describe("the new code of Module 008 never touches a price, cost, balance or invoice value", () => {
  for (const file of FILES) {
    it(file, () => {
      const source = withoutComments(readFileSync(resolve(process.cwd(), file), "utf8"));
      const hit = FORBIDDEN.exec(source);
      expect(hit?.[0] ?? null, `${file} mentions "${hit?.[0]}"`).toBeNull();
    });
  }

  it("selects only the slim columns in the repository", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/orders/fast-repository.ts"), "utf8");
    expect(source).not.toMatch(/select\(\s*["'`]\*["'`]/); // never select(*)
    expect(source).not.toMatch(/\.select\(\s*["'`][^"'`]*(price_snapshot|mrp|purchase)/i);
  });

  it("uses no browser storage and no service-role key", () => {
    for (const file of FILES) {
      const source = withoutComments(readFileSync(resolve(process.cwd(), file), "utf8"));
      expect(source, file).not.toMatch(/localStorage|sessionStorage|indexedDB/);
      expect(source, file).not.toMatch(/SERVICE_ROLE|service_role/);
    }
  });
});
