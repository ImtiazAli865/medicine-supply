import { describe, expect, it } from "vitest";
import { parseWithRules } from "@/lib/voice/rules";

// "Use the simple reader" (research D8): clear digit-and-comma sentences only; it never reads number words, never guesses a
// medicine, a quantity or a unit; a part it cannot read is returned as unreadable. SC-011: at least 90% of the clear
// sentences read correctly and 100% of the parts it cannot read are flagged.

type Expected = { store: string | null; items: Array<[string, number, string | null]>; unreadable?: string[] };

const clear: Array<[string, string, Expected]> = [
  ["a store, comma separated", "Nimer: Panadol 20 strips, Brufen 10 box", { store: "Nimer", items: [["Panadol", 20, "strips"], ["Brufen", 10, "box"]] }],
  ["and between items", "Nimer: Panadol 20 strips and Brufen 10 box", { store: "Nimer", items: [["Panadol", 20, "strips"], ["Brufen", 10, "box"]] }],
  ["aur between items", "Nimer: Panadol 20 strips aur Brufen 10 box", { store: "Nimer", items: [["Panadol", 20, "strips"], ["Brufen", 10, "box"]] }],
  ["comma and and", "Nimer: Panadol 20 strips, Brufen 10 box, and Calpol 5 bottles", { store: "Nimer", items: [["Panadol", 20, "strips"], ["Brufen", 10, "box"], ["Calpol", 5, "bottles"]] }],
  ["no store", "Panadol 20 strips, Brufen 10 box", { store: null, items: [["Panadol", 20, "strips"], ["Brufen", 10, "box"]] }],
  ["a store before a comma", "Nimer, Panadol 20 strips, Brufen 10 box", { store: "Nimer", items: [["Panadol", 20, "strips"], ["Brufen", 10, "box"]] }],
  ["semicolons", "Nimer: Panadol 20 strips; Brufen 10 box", { store: "Nimer", items: [["Panadol", 20, "strips"], ["Brufen", 10, "box"]] }],
  ["line breaks", "Nimer:\nPanadol 20 strips\nBrufen 10 box", { store: "Nimer", items: [["Panadol", 20, "strips"], ["Brufen", 10, "box"]] }],
  ["a final full stop", "Nimer: Panadol 20 strips, Brufen 10 box.", { store: "Nimer", items: [["Panadol", 20, "strips"], ["Brufen", 10, "box"]] }],
  ["extra spaces", "  Nimer :   Panadol   20   strips ,  Brufen 10 box  ", { store: "Nimer", items: [["Panadol", 20, "strips"], ["Brufen", 10, "box"]] }],
  ["a two-word unit", "Nimer: Panadol 20 big box", { store: "Nimer", items: [["Panadol", 20, "big box"]] }],
  ["no unit", "Nimer: Panadol 20", { store: "Nimer", items: [["Panadol", 20, null]] }],
  ["a two-word medicine name", "Nimer: cough syrup 5 bottles", { store: "Nimer", items: [["cough syrup", 5, "bottles"]] }],
  ["a store of several words", "Al Madina Medical: Panadol 20 strips", { store: "Al Madina Medical", items: [["Panadol", 20, "strips"]] }],
  ["leading zeros", "Nimer: Panadol 007 strips", { store: "Nimer", items: [["Panadol", 7, "strips"]] }],
  ["the largest accepted size", "Nimer: Panadol 100000 strips", { store: "Nimer", items: [["Panadol", 100000, "strips"]] }],
  ["a quantity of zero is read as zero (flagged later)", "Nimer: Panadol 0 strips", { store: "Nimer", items: [["Panadol", 0, "strips"]] }],
  ["capital letters", "NIMER: PANADOL 20 STRIPS", { store: "NIMER", items: [["PANADOL", 20, "STRIPS"]] }],
  ["an Urdu-script name is kept as spoken", "Nimer: پینا ڈول 20 strips", { store: "Nimer", items: [["پینا ڈول", 20, "strips"]] }],
  ["a single item", "Brufen 10 box", { store: null, items: [["Brufen", 10, "box"]] }],
];

const unclear: Array<[string, string, { items: number; unreadable: string[] }]> = [
  ["a number word before the name", "Nimer: twenty Panadol", { items: 0, unreadable: ["twenty Panadol"] }],
  ["a number word after the name", "Nimer: Panadol twenty strips", { items: 0, unreadable: ["Panadol twenty strips"] }],
  ["no quantity", "Nimer: Panadol strips", { items: 0, unreadable: ["Panadol strips"] }],
  ["two numbers in one item (strength and quantity)", "Nimer: Panadol 500 20 strips", { items: 0, unreadable: ["Panadol 500 20 strips"] }],
  ["a decimal quantity", "Nimer: Panadol 2.5 strips", { items: 0, unreadable: ["Panadol 2.5 strips"] }],
  ["a negative quantity", "Nimer: Panadol -3 strips", { items: 0, unreadable: ["Panadol -3 strips"] }],
  ["a seven-digit quantity", "Nimer: Panadol 1234567 strips", { items: 0, unreadable: ["Panadol 1234567 strips"] }],
  ["text that is not an order", "hello how are you", { items: 0, unreadable: ["hello how are you"] }],
  ["one readable and one unreadable item", "Nimer: Panadol 20 strips, twenty Brufen, Calpol 5 bottles", { items: 2, unreadable: ["twenty Brufen"] }],
  ["a quantity range", "Nimer: Panadol 10 to 20 strips", { items: 0, unreadable: ["Panadol 10 to 20 strips"] }],
];

describe("parseWithRules: clear sentences", () => {
  it.each(clear)("%s", (_label, text, expected) => {
    const result = parseWithRules(text);
    expect(result.store).toBe(expected.store);
    expect(result.items.map((i) => [i.name, i.quantity, i.unit])).toEqual(expected.items);
    expect(result.unreadable).toEqual(expected.unreadable ?? []);
  });

  it("reads at least 90% of the clear sentences correctly (SC-011)", () => {
    const correct = clear.filter(([, text, expected]) => {
      const result = parseWithRules(text);
      return result.store === expected.store && JSON.stringify(result.items.map((i) => [i.name, i.quantity, i.unit])) === JSON.stringify(expected.items);
    }).length;
    expect(correct / clear.length).toBeGreaterThanOrEqual(0.9);
  });
});

describe("parseWithRules: sentences it must not guess", () => {
  it.each(unclear)("%s", (_label, text, expected) => {
    const result = parseWithRules(text);
    expect(result.items).toHaveLength(expected.items);
    expect(result.unreadable).toEqual(expected.unreadable);
  });

  it("flags 100% of the unclear parts and never invents an item for them", () => {
    for (const [, text, expected] of unclear) {
      const result = parseWithRules(text);
      expect(result.unreadable.length, text).toBe(expected.unreadable.length);
      // nothing in the items comes from an unreadable part
      for (const part of result.unreadable) expect(result.items.some((i) => part.startsWith(i.name) && part.includes(String(i.quantity)))).toBe(false);
    }
  });
});

describe("parseWithRules: edges", () => {
  it("returns nothing for an empty or blank text", () => {
    expect(parseWithRules("")).toEqual({ store: null, items: [], unreadable: [] });
    expect(parseWithRules("   \n  ")).toEqual({ store: null, items: [], unreadable: [] });
  });

  it("reads a lone store name and no items", () => {
    expect(parseWithRules("Nimer:")).toEqual({ store: "Nimer", items: [], unreadable: [] });
  });

  it("never takes an unreadable first part as the store when no other part has a number", () => {
    const result = parseWithRules("hello, there");
    expect(result.store).toBeNull();
    expect(result.unreadable).toEqual(["hello", "there"]);
  });

  it("caps the items at 200 and flags the rest", () => {
    const text = Array.from({ length: 205 }, () => "Medicine 1 box").join(", ");
    const result = parseWithRules(text);
    expect(result.items).toHaveLength(200);
    expect(result.unreadable).toHaveLength(5);
  });

  it("never reads a price, a balance or a number word", () => {
    const result = parseWithRules("Nimer: Panadol 20 strips price 125.50");
    expect(result.items.every((i) => i.name !== "price")).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/"price"|"mrp"|"balance"/);
  });
});
