import { describe, expect, it } from "vitest";
import { appendLines, emptyState, infoFromProduct, LIMITS, removeLinesById } from "@/lib/orders/editor-state";
import type { OrderLineInput } from "@/lib/orders/types";

const line = (id: string, quantity = 1, product_id: string | null = "p"): OrderLineInput => ({ id, product_id, name: product_id ? null : "typed", quantity, unit: "strip" });

describe("appendLines", () => {
  it("adds several lines in one change, in order, with the ids given", () => {
    const result = appendLines(emptyState("s"), [line("a", 5), line("b", 7), line("c", 1, null)]);
    expect(result.state.lines.map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(result.added).toHaveLength(3);
    expect(result.refused).toBe(0);
    expect(result.state.storeId).toBe("s");
  });

  it("keeps existing lines first and does not merge the same medicine", () => {
    const start = { ...emptyState("s"), lines: [line("x", 2, "p")] };
    const result = appendLines(start, [line("y", 3, "p")]);
    expect(result.state.lines.map((l) => l.id)).toEqual(["x", "y"]);
  });

  it("refuses lines beyond the 200-line limit and counts them", () => {
    const start = { ...emptyState("s"), lines: Array.from({ length: LIMITS.lines - 2 }, (_, i) => line(`e${i}`)) };
    const result = appendLines(start, [line("n1"), line("n2"), line("n3"), line("n4")]);
    expect(result.state.lines).toHaveLength(LIMITS.lines);
    expect(result.added.map((l) => l.id)).toEqual(["n1", "n2"]);
    expect(result.refused).toBe(2);
  });

  it("refuses an invalid quantity instead of adding it", () => {
    const result = appendLines(emptyState("s"), [line("a", 0), line("b", 100001), line("c", 1.5), line("d", 100000)]);
    expect(result.added.map((l) => l.id)).toEqual(["d"]);
    expect(result.refused).toBe(3);
  });

  it("does not change the state it was given", () => {
    const start = emptyState("s");
    appendLines(start, [line("a")]);
    expect(start.lines).toEqual([]);
  });
});

describe("removeLinesById", () => {
  it("removes exactly the given lines and ignores unknown ids", () => {
    const start = { ...emptyState("s"), lines: [line("a"), line("b"), line("c")] };
    expect(removeLinesById(start, ["a", "c", "zzz"]).lines.map((l) => l.id)).toEqual(["b"]);
  });
});

describe("infoFromProduct", () => {
  it("accepts the slim shape and shows the current selling price", () => {
    const info = infoFromProduct({ name: "Panadol", strength: "500 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK", selling_price: "12.50" });
    expect(info).toMatchObject({ name: "Panadol", price_basis: "current", selling_price: "12.50", typed: false });
    expect(infoFromProduct({ name: "x", strength: null, dosage_form: null, pack_size: null, manufacturer: null, selling_price: null }).price_basis).toBe("none");
  });
});
