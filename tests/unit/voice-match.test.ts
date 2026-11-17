import { describe, expect, it } from "vitest";
import { buildPreview, classifyMatch, looksLikeSeveralStores, resolveStore } from "@/lib/voice/match";
import { candidate, exampleRawParse, rawItem, rawParse } from "../helpers/voice";

// What a spoken name MEANS is decided here, by application code (research D6): matched only for exactly one exact
// candidate, otherwise choose one (nothing preselected) or unknown. The long sentence set is in a later task.

const exact = (id: string, name: string, extra = {}) => candidate(id, name, { is_exact: true, ...extra });
const near = (id: string, name: string, extra = {}) => candidate(id, name, { is_exact: false, ...extra });

describe("classifyMatch", () => {
  it("is matched for exactly one exact candidate", () => {
    expect(classifyMatch([exact("a", "Panadol")])).toEqual({ state: "matched", id: "a" });
  });

  it("is matched for one exact candidate even when near candidates exist (the spoken name equals one name exactly)", () => {
    expect(classifyMatch([exact("a", "Panadol"), near("b", "Panadol Extra")])).toEqual({ state: "matched", id: "a" });
  });

  it("is choose one for two exact candidates (two strengths, forms, manufacturers or pack sizes)", () => {
    expect(classifyMatch([exact("a", "Panadol", { strength: "500 mg" }), exact("b", "Panadol", { strength: "650 mg" })])).toEqual({ state: "choose_one", id: null });
  });

  it("is choose one for near candidates only (a spelling or sound difference), never matched", () => {
    expect(classifyMatch([near("a", "Panadol"), near("b", "Pandol")])).toEqual({ state: "choose_one", id: null });
    expect(classifyMatch([near("a", "Brufen")])).toEqual({ state: "choose_one", id: null });
  });

  it("is unknown for no candidate", () => {
    expect(classifyMatch([])).toEqual({ state: "unknown", id: null });
  });
});

describe("resolveStore", () => {
  it("is not_named when no store was spoken", () => {
    expect(resolveStore(null, [])).toEqual({ spoken: null, state: "not_named", candidates: [], storeId: null });
    expect(resolveStore("   ", [exact("s", "Nimer")]).state).toBe("not_named");
  });

  it("is matched for one exact store, choose one for several or near, unknown for none", () => {
    expect(resolveStore("Al Madina Medical", [exact("s1", "Al Madina Medical")])).toMatchObject({ state: "matched", storeId: "s1" });
    expect(resolveStore("Madina", [near("s1", "Al Madina Medical"), near("s2", "Madina Medical Store")])).toMatchObject({ state: "choose_one", storeId: null });
    expect(resolveStore("Nowhere", [])).toMatchObject({ state: "unknown", storeId: null });
  });

  it("offers at most five candidates", () => {
    const rows = Array.from({ length: 8 }, (_, i) => near(`s${i}`, `Store ${i}`));
    expect(resolveStore("Store", rows).candidates).toHaveLength(5);
  });
});

describe("looksLikeSeveralStores", () => {
  it("flags a comma, a semicolon, and and aur", () => {
    expect(looksLikeSeveralStores("Al Madina, Al Shifa")).toBe(true);
    expect(looksLikeSeveralStores("Al Madina and Al Shifa")).toBe(true);
    expect(looksLikeSeveralStores("Al Madina aur Al Shifa")).toBe(true);
    expect(looksLikeSeveralStores("Al Madina Medical")).toBe(false);
    expect(looksLikeSeveralStores(null)).toBe(false);
  });
});

describe("buildPreview", () => {
  it("builds matched, choose one and unknown lines with their quantities and units", () => {
    const preview = buildPreview({
      parser: "ai",
      raw: exampleRawParse(),
      storeRows: [exact("store-1", "Al Madina Medical")],
      productRows: [
        { idx: 0, ...exact("p-panadol", "Panadol", { unit: "strip" }) },
        { idx: 1, ...exact("p-b1", "Brufen", { strength: "400 mg" }) },
        { idx: 1, ...exact("p-b2", "Brufen", { strength: "200 mg" }) },
      ],
    });
    expect(preview.store).toMatchObject({ state: "matched", storeId: "store-1" });
    expect(preview.lines.map((l) => l.state)).toEqual(["matched", "choose_one", "unknown"]);
    expect(preview.lines[0]).toMatchObject({ productId: "p-panadol", quantity: 20, unit: "strips", flags: [] });
    expect(preview.lines[1]).toMatchObject({ productId: null, quantity: 10 });
    expect(preview.lines[1].candidates).toHaveLength(2);
    expect(preview.lines[2]).toMatchObject({ spoken: "cough syrup", productId: null, candidates: [], quantity: 5, unit: "bottles" });
  });

  it("flags a missing, zero, fractional or huge quantity and leaves it empty", () => {
    const preview = buildPreview({
      parser: "ai",
      raw: rawParse("Nimer", [rawItem("A", null, "box"), rawItem("B", 0, "box"), rawItem("C", 2.5, "box"), rawItem("D", 100001, "box"), rawItem("E", -1, "box")]),
      storeRows: [],
      productRows: [],
    });
    expect(preview.lines.map((l) => l.quantity)).toEqual([null, null, null, null, null]);
    expect(preview.lines.map((l) => l.flags[0])).toEqual(["missing_quantity", "quantity_too_small", "quantity_not_whole", "quantity_too_large", "quantity_too_small"]);
  });

  it("uses the medicine's own unit with unit_not_heard when no unit was spoken", () => {
    const preview = buildPreview({
      parser: "ai",
      raw: rawParse(null, [rawItem("Panadol", 5, null), rawItem("Unknown thing", 5, null)]),
      storeRows: [],
      productRows: [{ idx: 0, ...exact("p1", "Panadol", { unit: "strip" }) }],
    });
    expect(preview.lines[0]).toMatchObject({ unit: "strip", flags: ["unit_not_heard"] });
    expect(preview.lines[1]).toMatchObject({ unit: null, flags: ["unit_not_heard"] });
  });

  it("keeps the same medicine spoken twice as two lines, both with a warning", () => {
    const preview = buildPreview({ parser: "ai", raw: rawParse("Nimer", [rawItem("Panadol", 5), rawItem("panadol", 6)]), storeRows: [], productRows: [] });
    expect(preview.lines).toHaveLength(2);
    expect(preview.lines.every((l) => l.flags.includes("duplicate_spoken"))).toBe(true);
  });

  it("flags more than one store only when the store is not matched exactly", () => {
    const several = buildPreview({ parser: "ai", raw: rawParse("Al Madina and Al Shifa", []), storeRows: [near("s1", "Al Madina Medical")], productRows: [] });
    expect(several.more_than_one_store).toBe(true);
    const named = buildPreview({ parser: "ai", raw: rawParse("Smith and Sons", []), storeRows: [exact("s2", "Smith and Sons")], productRows: [] });
    expect(named.more_than_one_store).toBe(false);
  });

  it("returns no price, MRP, cost or balance field anywhere", () => {
    const preview = buildPreview({ parser: "ai", raw: exampleRawParse(), storeRows: [], productRows: [{ idx: 0, ...exact("p", "Panadol") }] });
    expect(JSON.stringify(preview)).not.toMatch(/price|mrp|cost|margin|profit|balance/i);
  });

  it("never carries the score or the index of a candidate to the screen", () => {
    const preview = buildPreview({ parser: "ai", raw: rawParse(null, [rawItem("Panadol")]), storeRows: [], productRows: [{ idx: 0, score: 0.9, ...exact("p", "Panadol") }] });
    expect(Object.keys(preview.lines[0].candidates[0])).not.toContain("score");
    expect(Object.keys(preview.lines[0].candidates[0])).not.toContain("idx");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The test set (SC-002): at least 30 spoken names and stores. No case ever yields a catalog line without the supplier's
// choice, and matched appears only for exactly one exact candidate.
// ---------------------------------------------------------------------------------------------------------------

describe("the test set: every combination of exact and near candidates", () => {
  const combos: Array<[number, number]> = [];
  for (let exactCount = 0; exactCount <= 4; exactCount += 1) for (let nearCount = 0; nearCount <= 3; nearCount += 1) combos.push([exactCount, nearCount]);

  it.each(combos)("%i exact and %i near candidates", (exactCount, nearCount) => {
    const rows = [
      ...Array.from({ length: exactCount }, (_, i) => exact(`e${i}`, "Medicine", { strength: `${i} mg` })),
      ...Array.from({ length: nearCount }, (_, i) => near(`n${i}`, "Medicin", { strength: `${i} mg` })),
    ];
    const result = classifyMatch(rows);
    if (exactCount === 1) expect(result).toEqual({ state: "matched", id: "e0" });
    else if (rows.length > 0) expect(result).toEqual({ state: "choose_one", id: null });
    else expect(result).toEqual({ state: "unknown", id: null });
    // a doubtful result never carries an id
    if (result.state !== "matched") expect(result.id).toBeNull();
  });
});

describe("the test set: named sentences through buildPreview", () => {
  const preview = (name: string, rows: Array<ReturnType<typeof exact>>, quantity: number | null = 5, unit: string | null = "box") =>
    buildPreview({ parser: "ai", raw: rawParse("Nimer", [rawItem(name, quantity, unit)]), storeRows: [], productRows: rows.map((r) => ({ idx: 0, ...r })) }).lines[0];

  it("two strengths of one brand: choose one with both strengths shown", () => {
    const line = preview("Panadol", [exact("a", "Panadol", { strength: "500 mg" }), exact("b", "Panadol", { strength: "650 mg" })]);
    expect(line.state).toBe("choose_one");
    expect(line.candidates.map((c) => c.strength)).toEqual(["500 mg", "650 mg"]);
    expect(line.productId).toBeNull();
  });

  it("different forms of one name: choose one", () => {
    expect(preview("Calpol", [exact("a", "Calpol", { dosage_form: "syrup" }), exact("b", "Calpol", { dosage_form: "tablet" })]).state).toBe("choose_one");
  });

  it("different manufacturers: choose one", () => {
    expect(preview("Augmentin 625", [exact("a", "Augmentin 625", { manufacturer: "GSK" }), exact("b", "Augmentin 625", { manufacturer: "Other Pharma" })]).state).toBe("choose_one");
  });

  it("different pack sizes: choose one", () => {
    expect(preview("Brufen", [exact("a", "Brufen", { pack_size: "10" }), exact("b", "Brufen", { pack_size: "20" })]).state).toBe("choose_one");
  });

  it("a spelling variant: choose one, never matched", () => {
    expect(preview("Panadl", [near("a", "Panadol")]).state).toBe("choose_one");
  });

  it("a sound-alike spoken name: choose one, never matched", () => {
    expect(preview("Brufin", [near("a", "Brufen")]).state).toBe("choose_one");
  });

  it("an Urdu-script name with no candidate becomes an unknown typed line keeping the exact text", () => {
    const line = preview("پینا ڈول", []);
    expect(line).toMatchObject({ state: "unknown", spoken: "پینا ڈول", candidates: [], productId: null });
  });

  it("an Urdu-script name with a similar candidate: choose one", () => {
    expect(preview("پینا ڈول", [near("a", "Panadol")]).state).toBe("choose_one");
  });

  it("an empty catalog: every product is unknown", () => {
    const result = buildPreview({ parser: "ai", raw: exampleRawParse(), storeRows: [], productRows: [] });
    expect(result.lines.map((l) => l.state)).toEqual(["unknown", "unknown", "unknown"]);
  });

  it("the same medicine spoken three times: three lines, all warned, none merged", () => {
    const result = buildPreview({ parser: "ai", raw: rawParse("Nimer", [rawItem("Brufen", 1), rawItem("Brufen", 2), rawItem("brufen", 3)]), storeRows: [], productRows: [] });
    expect(result.lines).toHaveLength(3);
    expect(result.lines.every((l) => l.flags.includes("duplicate_spoken"))).toBe(true);
  });

  it("a brand spoken for two products: choose one", () => {
    expect(preview("Calpol", [exact("a", "Calpol Syrup"), exact("b", "Calpol Drops")]).state).toBe("choose_one");
  });

  it("a name with the strength spoken that equals exactly one product: matched", () => {
    expect(preview("Panadol 500 mg", [exact("a", "Panadol", { strength: "500 mg" })]).state).toBe("matched");
  });
});

describe("the test set: stores", () => {
  it("exact, near, several, none and blank store names", () => {
    expect(resolveStore("Al Madina Medical", [exact("s1", "Al Madina Medical")]).state).toBe("matched");
    expect(resolveStore("Almadina", [near("s1", "Al Madina Medical")]).state).toBe("choose_one");
    expect(resolveStore("Madina", [near("s1", "Al Madina Medical"), near("s2", "Madina Medical Store")]).state).toBe("choose_one");
    expect(resolveStore("Two exact", [exact("s1", "Two exact"), exact("s2", "Two exact")]).state).toBe("choose_one");
    expect(resolveStore("Nowhere", []).state).toBe("unknown");
    expect(resolveStore("", []).state).toBe("not_named");
    expect(resolveStore(null, [exact("s1", "x")]).state).toBe("not_named");
  });

  it("a store matched exactly is never overridden by a similar one", () => {
    expect(resolveStore("Madina Medical Store", [exact("s2", "Madina Medical Store"), near("s1", "Al Madina Medical")])).toMatchObject({ state: "matched", storeId: "s2" });
  });
});
