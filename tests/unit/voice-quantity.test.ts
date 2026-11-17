import { describe, expect, it } from "vitest";
import { isUsableQuantity, normaliseQuantity, normaliseUnit } from "@/lib/voice/quantity";

// Quantity and unit rules (research D7): a whole number from 1 to 100,000; a doubtful value is flagged, never rounded
// or invented.

describe("normaliseQuantity", () => {
  it("accepts whole numbers from 1 to 100,000", () => {
    for (const n of [1, 2, 20, 99999, 100000]) expect(normaliseQuantity(n)).toEqual({ quantity: n, flags: [] });
  });

  it("flags a missing quantity", () => {
    expect(normaliseQuantity(null)).toEqual({ quantity: null, flags: ["missing_quantity"] });
    expect(normaliseQuantity(undefined)).toEqual({ quantity: null, flags: ["missing_quantity"] });
  });

  it("flags zero and negatives as too small, never rounding", () => {
    for (const n of [0, -1, -100]) expect(normaliseQuantity(n)).toEqual({ quantity: null, flags: ["quantity_too_small"] });
  });

  it("flags a fraction as not whole, never rounding it", () => {
    for (const n of [2.5, 0.5, 19.999, -2.5]) expect(normaliseQuantity(n)).toEqual({ quantity: null, flags: ["quantity_not_whole"] });
  });

  it("flags a huge quantity", () => {
    for (const n of [100001, 1e9]) expect(normaliseQuantity(n)).toEqual({ quantity: null, flags: ["quantity_too_large"] });
  });

  it("flags a value that is not a finite number", () => {
    expect(normaliseQuantity(Number.NaN)).toEqual({ quantity: null, flags: ["quantity_not_whole"] });
    expect(normaliseQuantity(Number.POSITIVE_INFINITY)).toEqual({ quantity: null, flags: ["quantity_not_whole"] });
  });

  it("isUsableQuantity agrees", () => {
    expect(isUsableQuantity(5)).toBe(true);
    expect(isUsableQuantity(0)).toBe(false);
    expect(isUsableQuantity(null)).toBe(false);
  });
});

describe("normaliseUnit", () => {
  it("keeps the spoken unit, cleaned of extra spaces", () => {
    expect(normaliseUnit("  strips ", "box")).toEqual({ unit: "strips", flags: [] });
    expect(normaliseUnit("big   box", null)).toEqual({ unit: "big box", flags: [] });
  });

  it("cuts a unit longer than 50 characters", () => {
    expect(normaliseUnit("u".repeat(80), null).unit).toHaveLength(50);
  });

  it("falls back to the medicine's own unit with unit_not_heard when none was spoken", () => {
    expect(normaliseUnit(null, "strip")).toEqual({ unit: "strip", flags: ["unit_not_heard"] });
    expect(normaliseUnit("   ", "bottle")).toEqual({ unit: "bottle", flags: ["unit_not_heard"] });
  });

  it("leaves the unit empty (flagged) for an unknown medicine with no unit", () => {
    expect(normaliseUnit(null, null)).toEqual({ unit: null, flags: ["unit_not_heard"] });
    expect(normaliseUnit("", undefined)).toEqual({ unit: null, flags: ["unit_not_heard"] });
  });
});
