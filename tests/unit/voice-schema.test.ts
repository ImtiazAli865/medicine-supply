import { describe, expect, it } from "vitest";
import { ParserError, validateAnswer } from "@/lib/voice/parser";

// The answer schema (research D5): a wrong structure refuses the whole answer, extra fields such as a price are dropped,
// and a numeric but doubtful quantity passes so that it can be flagged later (never rounded).

const ok = (items: unknown[], store: unknown = "Nimer") => ({ store, items });
const refused = (value: unknown) => {
  try {
    validateAnswer(value);
  } catch (error) {
    return error instanceof ParserError && error.code === "ai_invalid";
  }
  return false;
};

describe("validateAnswer", () => {
  it("accepts the contract shape", () => {
    expect(validateAnswer(ok([{ name: "Panadol", quantity: 20, unit: "strips" }]))).toEqual({
      store: "Nimer",
      items: [{ name: "Panadol", quantity: 20, unit: "strips" }],
      unreadable: [],
    });
  });

  it("accepts a missing store, null fields and an empty list", () => {
    expect(validateAnswer({ items: [] })).toEqual({ store: null, items: [], unreadable: [] });
    expect(validateAnswer(ok([{ name: "Brufen", quantity: null, unit: null }], null)).items[0]).toEqual({ name: "Brufen", quantity: null, unit: null });
    expect(validateAnswer(ok([{ name: "Brufen" }])).items[0]).toEqual({ name: "Brufen", quantity: null, unit: null });
    expect(validateAnswer(ok([], "")).store).toBeNull();
  });

  it("drops unknown fields such as a price, an MRP or a balance", () => {
    const parsed = validateAnswer({
      store: "Nimer",
      total: "100.00",
      items: [{ name: "Panadol", quantity: 1, unit: "strip", price: "125.50", mrp: "130.00", selling_price: "125.50", balance: "5" }],
    });
    expect(parsed.items[0]).toEqual({ name: "Panadol", quantity: 1, unit: "strip" });
    expect(JSON.stringify(parsed)).not.toMatch(/price|mrp|balance|total/i);
  });

  it("refuses the whole answer for a wrong structure", () => {
    for (const bad of [
      null,
      "text",
      [],
      { items: "nope" },
      { items: null },
      {},
      { store: 5, items: [] },
      { store: "x".repeat(201), items: [] },
      ok([{ name: 5, quantity: 1, unit: "strip" }]),
      ok([{ quantity: 1, unit: "strip" }]),
      ok([{ name: "", quantity: 1 }]),
      ok([{ name: "   ", quantity: 1 }]),
      ok([{ name: "x".repeat(201), quantity: 1 }]),
      ok([{ name: "Panadol", quantity: "20", unit: "strip" }]),
      ok([{ name: "Panadol", quantity: "twenty", unit: "strip" }]),
      ok([{ name: "Panadol", quantity: { n: 20 }, unit: "strip" }]),
      ok([{ name: "Panadol", quantity: 1, unit: "u".repeat(51) }]),
      ok([{ name: "Panadol", quantity: 1, unit: 5 }]),
      ok([null]),
    ]) {
      expect(refused(bad), JSON.stringify(bad)).toBe(true);
    }
  });

  it("refuses 201 items and accepts 200", () => {
    const item = { name: "Panadol", quantity: 1, unit: "strip" };
    expect(validateAnswer(ok(Array.from({ length: 200 }, () => item))).items).toHaveLength(200);
    expect(refused(ok(Array.from({ length: 201 }, () => item)))).toBe(true);
  });

  it("lets a numeric but doubtful quantity through, unrounded, to be flagged later", () => {
    for (const quantity of [0, -3, 2.5, 1e9, 100001]) {
      expect(validateAnswer(ok([{ name: "Panadol", quantity, unit: "strip" }])).items[0].quantity).toBe(quantity);
    }
  });

  it("trims names, units and the store", () => {
    const parsed = validateAnswer({ store: "  Nimer  ", items: [{ name: "  Panadol  ", quantity: 1, unit: "  strips " }] });
    expect(parsed.store).toBe("Nimer");
    expect(parsed.items[0]).toEqual({ name: "Panadol", quantity: 1, unit: "strips" });
  });
});
