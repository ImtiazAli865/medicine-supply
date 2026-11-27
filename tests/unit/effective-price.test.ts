import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { catalogMoved, effectivePrice, needsPriceConfirmation, parsePriceInput, sameUnit } from "@/lib/orders/price";

// Module 012: the screen's price rule. The same cases are run against the database function
// (tests/integration/db-store-rates.pglite.test.ts), so the two can never disagree.

const CASES = JSON.parse(readFileSync(path.resolve("tests/fixtures/effective-price-cases.json"), "utf8")) as Array<Record<string, never>>;

describe("effectivePrice", () => {
  for (const c of CASES as unknown as Array<{ name: string; typedLine: boolean; chosen: string | null; rate: string | null; rateRemoved: boolean; productActive: boolean; lineUnit: string; productUnit: string; catalog: string | null; price: string | null; source: string | null }>) {
    it(c.name, () => {
      expect(
        effectivePrice({
          typedLine: c.typedLine,
          chosen: c.chosen,
          rate: c.rateRemoved ? null : c.rate,
          productActive: c.productActive,
          lineUnit: c.lineUnit,
          productUnit: c.productUnit,
          catalog: c.catalog,
        }),
      ).toEqual({ price: c.price, source: c.source });
    });
  }
});

describe("typing a price", () => {
  it("accepts a positive amount with at most two decimals, in canonical form", () => {
    expect(parsePriceInput("220")).toBe("220.00");
    expect(parsePriceInput(" 15.5 ")).toBe("15.50");
    for (const bad of ["", "0", "0.00", "-1", "1.234", "abc", "1,000", "99999999999"]) expect(parsePriceInput(bad), bad).toBeNull();
  });

  it("asks only when the price differs from the catalog by more than half", () => {
    expect(needsPriceConfirmation("22.00", "220.00")).toBe(true);
    expect(needsPriceConfirmation("2200.00", "220.00")).toBe(true);
    expect(needsPriceConfirmation("110.00", "220.00")).toBe(false);
    expect(needsPriceConfirmation("330.00", "220.00")).toBe(false);
    expect(needsPriceConfirmation("330.01", "220.00")).toBe(true);
    expect(needsPriceConfirmation("22.00", null)).toBe(false);
  });
});

describe("units and catalog changes", () => {
  it("compares units ignoring case and spacing", () => {
    expect(sameUnit(" Strip", "strip  ")).toBe(true);
    expect(sameUnit("box", "strip")).toBe(false);
  });

  it("says when the catalog price is no longer what it was when the rate was saved", () => {
    const rate = { rate: "220.00", version: 1, catalog_price_at_set: "200.00" };
    expect(catalogMoved(rate, "200.00")).toBe(false);
    expect(catalogMoved(rate, "210.00")).toBe(true);
    expect(catalogMoved(rate, null)).toBe(true);
    expect(catalogMoved({ ...rate, catalog_price_at_set: null }, null)).toBe(false);
    expect(catalogMoved(null, "210.00")).toBe(false);
  });
});
