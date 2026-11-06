import { describe, expect, it } from "vitest";
import { isExampleName } from "../../src/lib/import/columns";
import type { RawRow } from "../../src/lib/import/types";
import { validateRow } from "../../src/lib/import/validate-row";

const base = (extra: Partial<RawRow> = {}): RawRow => ({ row_no: 2, name: "Panadol", unit: "strip", ...extra });

function invalid(raw: RawRow) {
  const r = validateRow(raw);
  if (r.ok) throw new Error("expected invalid");
  return r.invalid;
}

describe("required fields", () => {
  it("requires name and unit, naming the cell", () => {
    expect(invalid(base({ name: null }))).toMatchObject({ row_no: 2, field: "name", message: "Name is required." });
    expect(invalid(base({ unit: "   " }))).toMatchObject({ field: "unit", message: "Unit is required." });
    expect(invalid({ row_no: 7 })).toMatchObject({ row_no: 7, field: "name" });
  });
});

describe("text cleaning (no defaults are ever invented)", () => {
  it("trims and collapses whitespace; empty cells become null", () => {
    const r = validateRow(base({ name: "  Pana   dol ", brand: "", strength: "  500  mg ", pack_size: undefined }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row).toMatchObject({ name: "Pana dol", strength: "500 mg", brand: null, pack_size: null, sku: null });
    for (const k of ["generic_name", "dosage_form", "manufacturer", "purchase_price", "selling_price", "mrp"] as const) {
      expect(r.row[k], k).toBeNull();
    }
  });

  it.each([
    ["name", 200], ["unit", 50], ["brand", 200], ["generic_name", 200], ["strength", 100],
    ["dosage_form", 100], ["manufacturer", 200], ["pack_size", 100], ["sku", 100],
  ] as const)("%s allows %i characters and refuses one more", (field, max) => {
    expect(validateRow(base({ [field]: "x".repeat(max) })).ok).toBe(true);
    expect(invalid(base({ [field]: "x".repeat(max + 1) }))).toMatchObject({ field });
  });
});

describe("prices", () => {
  it.each(["0", "10", "10.5", "10.50", "9999999999.99"])("accepts %s and stores two decimals", (p) => {
    const r = validateRow(base({ selling_price: p }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.selling_price).toMatch(/^\d+\.\d{2}$/);
  });

  it.each([
    ["-1", /cannot be negative/],
    ["abc", /digits with an optional decimal point/],
    ["1,250", /digits with an optional decimal point/],
    ["PKR 100", /digits with an optional decimal point/],
    ["1.234", /at most two decimals/],
    ["1e3", /digits with an optional decimal point/],
    ["12345678901", /too large/],
    [".5", /digits with an optional decimal point/],
  ])("refuses %s with a reason", (p, reason) => {
    for (const field of ["purchase_price", "selling_price", "mrp"] as const) {
      expect(invalid(base({ [field]: p }))).toMatchObject({ field, message: expect.stringMatching(reason) });
    }
  });

  it("never rounds: 0.30000000000000004 is invalid", () => {
    expect(invalid(base({ selling_price: "0.30000000000000004" })).message).toMatch(/at most two decimals/);
  });

  it("warns, without blocking, when selling < purchase or MRP < selling", () => {
    const a = validateRow(base({ purchase_price: "100", selling_price: "90", mrp: "120" }));
    expect(a.ok && a.warnings).toEqual(["selling_below_purchase"]);
    const b = validateRow(base({ purchase_price: "10", selling_price: "50", mrp: "40" }));
    expect(b.ok && b.warnings).toEqual(["mrp_below_selling"]);
    const c = validateRow(base({ purchase_price: "10", selling_price: "50", mrp: "60" }));
    expect(c.ok && c.warnings).toEqual([]);
  });
});

describe("example row marker", () => {
  it("recognises only the template's marked example", () => {
    expect(isExampleName("EXAMPLE - delete this row")).toBe(true);
    expect(isExampleName("example – Delete this row")).toBe(true);
    expect(isExampleName("Example Cough Syrup")).toBe(false);
    expect(isExampleName(null)).toBe(false);
  });
});
