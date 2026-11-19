import { describe, expect, it } from "vitest";
import { pickUsual, planRepeat, rankUsual, type ProductLookup, type RepeatSourceLine } from "@/lib/orders/fast-usual";
import type { SlimMedicine } from "@/lib/orders/fast-types";

function med(id: string, name = `Med ${id}`): SlimMedicine {
  return {
    id,
    name,
    unit: "strip",
    brand: null,
    generic_name: null,
    strength: "500 mg",
    dosage_form: "tablet",
    manufacturer: null,
    pack_size: "10",
    sku: null,
    selling_price: "10.00",
  };
}

const O1 = { id: "o1", confirmed_at: "2026-10-01T10:00:00Z" };
const O2 = { id: "o2", confirmed_at: "2026-10-10T10:00:00Z" };
const O3 = { id: "o3", confirmed_at: "2026-10-20T10:00:00Z" };

describe("rankUsual", () => {
  it("ranks by the number of orders, then the latest order, then id", () => {
    const ranked = rankUsual(
      [O1, O2, O3],
      [
        { order_id: "o1", product_id: "a", quantity: 1, unit: "strip", position: 1 },
        { order_id: "o2", product_id: "a", quantity: 2, unit: "strip", position: 1 },
        { order_id: "o3", product_id: "b", quantity: 3, unit: "box", position: 1 },
        { order_id: "o2", product_id: "c", quantity: 4, unit: "box", position: 2 },
        { order_id: "o1", product_id: "d", quantity: 5, unit: "box", position: 2 },
      ],
    );
    expect(ranked.map((r) => r.product_id)).toEqual(["a", "b", "c", "d"]);
    expect(ranked[0]).toMatchObject({ order_count: 2, last_ordered_at: O2.confirmed_at, last_quantity: 2, last_unit: "strip" });
  });

  it("counts a medicine once per order even when it appears twice", () => {
    const ranked = rankUsual(
      [O1, O2],
      [
        { order_id: "o1", product_id: "a", quantity: 1, unit: "strip", position: 1 },
        { order_id: "o1", product_id: "a", quantity: 9, unit: "strip", position: 2 },
        { order_id: "o2", product_id: "b", quantity: 1, unit: "strip", position: 1 },
        { order_id: "o1", product_id: "b", quantity: 1, unit: "strip", position: 3 },
      ],
    );
    expect(ranked.find((r) => r.product_id === "a")?.order_count).toBe(1);
    expect(ranked.find((r) => r.product_id === "b")?.order_count).toBe(2);
    // the latest line of the latest order wins for the quantity
    expect(ranked.find((r) => r.product_id === "a")?.last_quantity).toBe(9);
  });

  it("breaks an equal count and date by id, deterministically", () => {
    const ranked = rankUsual(
      [O1],
      [
        { order_id: "o1", product_id: "z", quantity: 1, unit: "strip", position: 1 },
        { order_id: "o1", product_id: "m", quantity: 1, unit: "strip", position: 2 },
      ],
    );
    expect(ranked.map((r) => r.product_id)).toEqual(["m", "z"]);
  });

  it("ignores lines of orders that are not in the qualifying list", () => {
    const ranked = rankUsual([O1], [{ order_id: "other", product_id: "a", quantity: 1, unit: "strip", position: 1 }]);
    expect(ranked).toEqual([]);
  });

  it("gives an empty result for an empty history", () => {
    expect(rankUsual([], [])).toEqual([]);
  });
});

describe("pickUsual", () => {
  const ranked = Array.from({ length: 14 }, (_, i) => ({
    product_id: `p${String(i).padStart(2, "0")}`,
    order_count: 14 - i,
    last_ordered_at: O1.confirmed_at,
    last_quantity: 1,
    last_unit: "strip",
  }));

  it("skips inactive and missing medicines before the cut so 12 active ones are returned", () => {
    const active = new Map(ranked.map((r) => [r.product_id, med(r.product_id)]));
    active.delete("p00");
    active.delete("p03");
    const picked = pickUsual(ranked, active);
    expect(picked).toHaveLength(12);
    expect(picked[0]?.medicine.id).toBe("p01");
    expect(picked.map((p) => p.medicine.id)).not.toContain("p03");
  });

  it("returns fewer than 12 when fewer are active", () => {
    const active = new Map([["p05", med("p05")]]);
    expect(pickUsual(ranked, active)).toHaveLength(1);
  });

  it("returns only the keys of an usual medicine (no extra data)", () => {
    const active = new Map(ranked.map((r) => [r.product_id, med(r.product_id)]));
    expect(Object.keys(pickUsual(ranked, active)[0]!).sort()).toEqual(["last_ordered_at", "last_quantity", "last_unit", "medicine", "order_count"]);
  });
});

describe("planRepeat", () => {
  const lookup: ProductLookup = new Map([
    ["a", { medicine: med("a", "Panadol"), active: true }],
    ["b", { medicine: med("b", "Brufen"), active: false }],
  ]);
  const lines: RepeatSourceLine[] = [
    { position: 1, product_id: "a", name: "Panadol", quantity: 5, unit: "strip" },
    { position: 2, product_id: null, name: "Pan d 500", quantity: 2, unit: "box" },
    { position: 3, product_id: "b", name: "Brufen", quantity: 1, unit: "box" },
    { position: 4, product_id: "gone", name: "Old thing", quantity: 1, unit: "box" },
  ];

  it("keeps catalog lines by id, typed lines as typed, and lists what was left out", () => {
    const plan = planRepeat(lines, lookup);
    expect(plan.lines).toEqual([
      { kind: "catalog", medicine: med("a", "Panadol"), quantity: 5, unit: "strip" },
      { kind: "typed", name: "Pan d 500", quantity: 2, unit: "box" },
    ]);
    expect(plan.skipped).toEqual([
      { name: "Brufen", reason: "inactive" },
      { name: "Old thing", reason: "missing" },
    ]);
  });

  it("copies the same medicine twice as it was (no silent merge)", () => {
    const plan = planRepeat(
      [
        { position: 1, product_id: "a", name: "Panadol", quantity: 5, unit: "strip" },
        { position: 2, product_id: "a", name: "Panadol", quantity: 7, unit: "box" },
      ],
      lookup,
    );
    expect(plan.lines.map((l) => l.quantity)).toEqual([5, 7]);
  });

  it("keeps the source order by position even if the input is unsorted", () => {
    const plan = planRepeat([lines[1]!, lines[0]!], lookup);
    expect(plan.lines.map((l) => l.kind)).toEqual(["catalog", "typed"]);
  });

  it("adds at most 200 lines and names the rest as over_limit", () => {
    const many: RepeatSourceLine[] = Array.from({ length: 203 }, (_, i) => ({
      position: i + 1,
      product_id: null,
      name: `Typed ${i + 1}`,
      quantity: 1,
      unit: "strip",
    }));
    const plan = planRepeat(many, lookup);
    expect(plan.lines).toHaveLength(200);
    expect(plan.skipped).toEqual([
      { name: "Typed 201", reason: "over_limit" },
      { name: "Typed 202", reason: "over_limit" },
      { name: "Typed 203", reason: "over_limit" },
    ]);
  });

  it("returns nothing for an empty source and never carries a price field", () => {
    expect(planRepeat([], lookup)).toEqual({ lines: [], skipped: [] });
    const line = planRepeat(lines, lookup).lines[0]!;
    expect(JSON.stringify(line)).not.toMatch(/purchase|mrp|cost|margin|profit|snapshot/);
  });
});
