import { describe, expect, it } from "vitest";
import { filterMedicines, highlightIndex, normalizeRow, parseQuery, MAX_RESULTS } from "@/lib/orders/fast-search";
import type { SlimMedicine } from "@/lib/orders/fast-types";

function med(id: string, name: string, extra: Partial<SlimMedicine> = {}): SlimMedicine {
  return { id, name, unit: "strip", brand: null, generic_name: null, strength: null, dosage_form: null, manufacturer: null, pack_size: null, sku: null, selling_price: null, ...extra };
}

const CATALOG = [
  med("1", "Panadol", { strength: "500 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK" }),
  med("2", "Panadol", { strength: "250 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK" }),
  med("3", "Panadol", { strength: "500 mg", dosage_form: "syrup", pack_size: "60 ml", manufacturer: "GSK" }),
  med("4", "Brufen", { strength: "400 mg", dosage_form: "tablet", generic_name: "Ibuprofen", sku: "BR-400" }),
  med("5", "Calpol", { strength: "120 mg", dosage_form: "syrup", brand: "Calpol Kids" }),
  med("6", "Augmentin", { strength: "625 mg", dosage_form: "tablet" }),
  med("7", "پینا ڈول", { strength: "500 mg" }),
];
const ROWS = CATALOG.map(normalizeRow);
const find = (text: string, max?: number) => filterMedicines(ROWS, parseQuery(text).words, max);
const ids = (text: string) => find(text).results.map((m) => m.id);

describe("parseQuery", () => {
  it("lower-cases, splits on extra spaces and keeps at most eight words", () => {
    expect(parseQuery("  PANADOL   500  ").words).toEqual(["panadol", "500"]);
    expect(parseQuery("a b c d e f g h i j").words).toHaveLength(8);
    expect(parseQuery("   ").words).toEqual([]);
  });
});

describe("filterMedicines", () => {
  it("matches every word against name, brand, generic name, strength, manufacturer or code, or the dosage form", () => {
    expect(ids("brufen")).toEqual(["4"]);
    expect(ids("ibuprofen")).toEqual(["4"]);
    expect(ids("br-400")).toEqual(["4"]);
    expect(ids("kids")).toEqual(["5"]);
    expect(ids("gsk").sort()).toEqual(["1", "2", "3"]);
    expect(ids("syrup")).toEqual(expect.arrayContaining(["3", "5"]));
    expect(ids("syrup")).toHaveLength(2);
  });

  it("is case-insensitive and ignores extra spaces", () => {
    expect(ids("  BRUFEN  ")).toEqual(["4"]);
    expect(ids("pan  tablet")).toHaveLength(2);
  });

  it("treats digits as text: 'panadol 500' narrows to the 500 strength and is never a quantity", () => {
    expect(ids("panadol 500").sort()).toEqual(["1", "3"]);
    expect(ids("panadol 500 syrup")).toEqual(["3"]);
    expect(ids("panadol 250")).toEqual(["2"]);
  });

  it("starts with names that begin with the first word, then by name and id", () => {
    const rows = [med("a", "Xpan"), med("b", "Panto"), med("c", "Pan"), med("d", "Apan")].map(normalizeRow);
    expect(filterMedicines(rows, ["pan"]).results.map((m) => m.id)).toEqual(["c", "b", "d", "a"]);
  });

  it("returns at most 30 results and counts the rest", () => {
    const many = Array.from({ length: 45 }, (_, i) => med(String(i).padStart(3, "0"), `Medicine ${String(i).padStart(3, "0")}`)).map(normalizeRow);
    const result = filterMedicines(many, ["medicine"]);
    expect(result.results).toHaveLength(MAX_RESULTS);
    expect(result.more).toBe(15);
  });

  it("returns nothing for no words", () => {
    expect(find("").results).toEqual([]);
    expect(find("   ").more).toBe(0);
  });

  it("returns nothing when one of the words matches nothing", () => {
    expect(ids("panadol zzz")).toEqual([]);
  });

  it("searches Urdu text as typed", () => {
    expect(ids("پینا")).toEqual(["7"]);
  });

  it("never merges different strengths, forms, manufacturers or pack sizes: each is its own result", () => {
    expect(find("panadol").results).toHaveLength(3);
    const all = new Set(find("panadol").results.map((m) => `${m.strength}|${m.dosage_form}|${m.pack_size}`));
    expect(all.size).toBe(3);
  });
});

describe("highlightIndex", () => {
  it("highlights only when exactly one medicine is left", () => {
    expect(highlightIndex(find("brufen").results, find("brufen").more)).toBe(0);
    expect(highlightIndex(find("panadol").results)).toBeNull();
    expect(highlightIndex([])).toBeNull();
  });

  it("never highlights when more medicines match than are shown", () => {
    expect(highlightIndex([CATALOG[0]!], 4)).toBeNull();
  });

  it("never highlights a name that has several strengths even when the text names the brand", () => {
    expect(highlightIndex(find("panadol 500").results)).toBeNull(); // 500 mg tablet and 500 mg syrup
  });
});
