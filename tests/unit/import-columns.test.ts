import { describe, expect, it } from "vitest";
import { COLUMNS, matchHeaders, TEMPLATE_HEADINGS } from "../../src/lib/import/columns";
import { ImportFileError } from "../../src/lib/import/types";

describe("template headings", () => {
  it("are exactly the 12 columns of the spec, in order", () => {
    expect(TEMPLATE_HEADINGS).toEqual([
      "name", "unit", "brand", "generic name", "strength", "dosage form",
      "manufacturer", "pack size", "sku", "purchase price", "selling price", "mrp",
    ]);
    expect(COLUMNS.filter((c) => c.required).map((c) => c.key)).toEqual(["name", "unit"]);
  });
});

describe("matchHeaders", () => {
  it("ignores case and extra spacing and accepts any order", () => {
    const { fields } = matchHeaders(["  UNIT ", "Name", "Generic   Name", "SKU", "MRP"]);
    expect(fields).toEqual(["unit", "name", "generic_name", "sku", "mrp"]);
  });

  it("accepts blank headings (the caller rejects them only when the column holds data)", () => {
    expect(matchHeaders(["name", "unit", "", null]).fields).toEqual(["name", "unit", null, null]);
  });

  const failure = (headings: (string | null)[]) => {
    try {
      matchHeaders(headings);
    } catch (e) {
      return e as ImportFileError;
    }
    throw new Error("expected a rejection");
  };

  it("rejects a missing required column and lists found and expected headings", () => {
    const e = failure(["name", "brand"]);
    expect(e).toBeInstanceOf(ImportFileError);
    expect(e.code).toBe("bad_headings");
    expect(e.message).toMatch(/Missing required column: unit/);
    expect(e.found).toEqual(["name", "brand"]);
    expect(e.expected).toEqual(TEMPLATE_HEADINGS);
  });

  it("rejects an unrecognised heading by name", () => {
    const e = failure(["name", "unit", "colour"]);
    expect(e.message).toMatch(/not in the template: colour/);
  });

  it("rejects a repeated heading", () => {
    const e = failure(["name", "unit", "Name"]);
    expect(e.message).toMatch(/Repeated column: name/);
  });

  it("treats a heading with an added marker such as 'name *' as unrecognised", () => {
    const e = failure(["name *", "unit"]);
    expect(e.message).toMatch(/Missing required column: name/);
    expect(e.message).toMatch(/not in the template: name \*/);
  });
});
