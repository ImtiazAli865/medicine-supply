import { describe, expect, it } from "vitest";
import { SLIM_MEDICINE_KEYS, type SlimMedicine } from "@/lib/orders/fast-types";

const FORBIDDEN = /purchase|mrp|cost|margin|profit|balance|snapshot|invoice/i;

describe("fast order entry types", () => {
  it("selects no price, cost, balance or snapshot column", () => {
    for (const key of SLIM_MEDICINE_KEYS) expect(key).not.toMatch(FORBIDDEN);
  });

  it("keeps the type and the column list in step", () => {
    const sample: SlimMedicine = {
      id: "x",
      name: "n",
      unit: "strip",
      brand: null,
      generic_name: null,
      strength: null,
      dosage_form: null,
      manufacturer: null,
      pack_size: null,
      sku: null,
      selling_price: null,
    };
    expect(Object.keys(sample).sort()).toEqual([...SLIM_MEDICINE_KEYS].sort());
  });

  it("has no forbidden property on SlimMedicine (compile-time)", () => {
    // @ts-expect-error purchase_price is never part of the slim medicine
    const bad: SlimMedicine["purchase_price"] = undefined;
    // @ts-expect-error mrp is never part of the slim medicine
    const bad2: SlimMedicine["mrp"] = undefined;
    expect([bad, bad2]).toEqual([undefined, undefined]);
  });
});
