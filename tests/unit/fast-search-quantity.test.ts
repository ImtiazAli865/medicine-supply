import { describe, expect, it } from "vitest";
import { normalizeRow, readQuantityHint, runSearch, splitQuantityHint } from "@/lib/orders/fast-search";
import type { SlimMedicine } from "@/lib/orders/fast-types";

function med(id: string, name: string, extra: Partial<SlimMedicine> = {}): SlimMedicine {
  return { id, name, unit: "strip", brand: null, generic_name: null, strength: null, dosage_form: null, manufacturer: null, pack_size: null, sku: null, selling_price: null, ...extra };
}

const ROWS = [
  med("1", "Panadol", { strength: "500 mg", dosage_form: "tablet" }),
  med("2", "Brufen", { strength: "400 mg" }),
  med("3", "Tonic x10", { pack_size: "x10 strips" }),
].map(normalizeRow);

describe("readQuantityHint", () => {
  it("reads x or the multiplication sign followed by 1 to 6 digits", () => {
    expect(readQuantityHint("x20")).toEqual({ text: "x20", value: 20 });
    expect(readQuantityHint("X5")).toEqual({ text: "X5", value: 5 });
    expect(readQuantityHint("×100")).toEqual({ text: "×100", value: 100 });
    expect(readQuantityHint("x100000")).toMatchObject({ value: 100000 });
  });

  it("reports an invalid number instead of ignoring it", () => {
    expect(readQuantityHint("x0")).toEqual({ text: "x0", value: null });
    expect(readQuantityHint("x100001")).toEqual({ text: "x100001", value: null });
    expect(readQuantityHint("x007")).toMatchObject({ value: 7 });
  });

  it("does not read anything else as a quantity", () => {
    for (const word of ["x", "20", "20x", "x1234567", "xx20", "x2.5", "x-5", "ex20", "x2o"]) expect(readQuantityHint(word), word).toBeNull();
  });
});

describe("splitQuantityHint", () => {
  it("takes only the last word and only when another word remains", () => {
    expect(splitQuantityHint("pan x20")).toEqual({ base: "pan", hint: { text: "x20", value: 20 } });
    expect(splitQuantityHint("pan 500 x20")?.base).toBe("pan 500");
    expect(splitQuantityHint("x20")).toBeNull();
    expect(splitQuantityHint("x20 pan")).toBeNull();
    expect(splitQuantityHint("pan x 20")).toBeNull();
    expect(splitQuantityHint("pan 20x")).toBeNull();
  });
});

describe("runSearch", () => {
  it("reads 'pan x20' as quantity 20 when the whole text matches nothing", () => {
    const outcome = runSearch(ROWS, "pan x20");
    expect(outcome.hint).toEqual({ text: "x20", value: 20 });
    expect(outcome.results.map((m) => m.id)).toEqual(["1"]);
  });

  it("searches a name that really contains 'x10' as text first and reads no quantity", () => {
    const outcome = runSearch(ROWS, "tonic x10");
    expect(outcome.hint).toBeNull();
    expect(outcome.results.map((m) => m.id)).toEqual(["3"]);
  });

  it("returns an invalid hint (never silently ignored) so the screen can state the range", () => {
    expect(runSearch(ROWS, "pan x0").hint).toEqual({ text: "x0", value: null });
    expect(runSearch(ROWS, "pan x100001").hint).toEqual({ text: "x100001", value: null });
  });

  it("does not read a hint when the text without it matches nothing either, and never chooses a result", () => {
    const outcome = runSearch(ROWS, "zzz x20");
    expect(outcome.results).toEqual([]);
    expect(outcome.hint).toEqual({ text: "x20", value: 20 }); // there is nothing to choose, so nothing is added
  });

  it("treats a plain search as text with no hint", () => {
    const outcome = runSearch(ROWS, "panadol 500");
    expect(outcome.hint).toBeNull();
    expect(outcome.results.map((m) => m.id)).toEqual(["1"]);
  });
});
