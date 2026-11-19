import { describe, expect, it } from "vitest";
import { buildRows, EMPTY_SELECTION, planAdd, pruneSelection, RANGE_TEXT, selectAll, setQuantityText, toggleRow } from "@/lib/orders/fast-checklist";
import type { RepeatLine, SlimMedicine } from "@/lib/orders/fast-types";

function med(id: string): SlimMedicine {
  return { id, name: `Med ${id}`, unit: "strip", brand: null, generic_name: null, strength: "500 mg", dosage_form: "tablet", manufacturer: null, pack_size: "10", sku: null, selling_price: "10.00" };
}
const cat = (id: string, quantity: number, unit = "strip"): RepeatLine => ({ kind: "catalog", medicine: med(id), quantity, unit });
const typed = (name: string, quantity: number): RepeatLine => ({ kind: "typed", name, quantity, unit: "bottle" });

const LINES: RepeatLine[] = [cat("a", 12), cat("b", 3, "box"), typed("Unknown tonic", 2), cat("a", 5, "box"), cat("c", 40)];

describe("buildRows", () => {
  it("makes one row per source line, keyed by position, so the same medicine twice gives two rows", () => {
    const rows = buildRows(LINES, new Set());
    expect(rows.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
    expect(rows.filter((r) => r.line.kind === "catalog" && r.line.medicine.id === "a")).toHaveLength(2);
  });

  it("marks catalog rows whose medicine is on the order, never typed rows", () => {
    const rows = buildRows(LINES, new Set(["a", "c"]));
    expect(rows.map((r) => r.onOrder)).toEqual([true, false, false, true, true]);
  });
});

describe("selection", () => {
  const rows = buildRows(LINES, new Set(["c"]));

  it("selecting a row starts at the last quantity and tapping again unselects it", () => {
    let sel = toggleRow(EMPTY_SELECTION, rows[0]!);
    expect(sel.get(0)).toBe("12");
    sel = toggleRow(sel, rows[0]!);
    expect(sel.size).toBe(0);
  });

  it("never selects a row that is on the order", () => {
    expect(toggleRow(EMPTY_SELECTION, rows[4]!).size).toBe(0);
  });

  it("changes the quantity only of a selected row", () => {
    const sel = setQuantityText(toggleRow(EMPTY_SELECTION, rows[1]!), 1, "7");
    expect(sel.get(1)).toBe("7");
    expect(setQuantityText(EMPTY_SELECTION, 1, "7").size).toBe(0);
  });

  it("select all skips rows on the order and keeps quantities already typed", () => {
    const start = setQuantityText(toggleRow(EMPTY_SELECTION, rows[0]!), 0, "20");
    const all = selectAll(rows, start);
    expect([...all.keys()]).toEqual([0, 1, 2, 3]);
    expect(all.get(0)).toBe("20");
  });

  it("drops rows that are on the order now", () => {
    const sel = selectAll(rows, EMPTY_SELECTION);
    const after = pruneSelection(sel, buildRows(LINES, new Set(["a", "c"])));
    expect([...after.keys()]).toEqual([1, 2]);
    expect(pruneSelection(after, buildRows(LINES, new Set(["a", "c"])))).toBe(after);
  });
});

describe("planAdd", () => {
  const rows = buildRows(LINES, new Set());

  it("builds the lines in source order with the chosen quantity and the unit of the source line", () => {
    let sel = toggleRow(EMPTY_SELECTION, rows[3]!);
    sel = toggleRow(sel, rows[0]!);
    sel = toggleRow(sel, rows[2]!);
    sel = setQuantityText(sel, 0, "30");
    const plan = planAdd(rows, sel);
    expect(plan.canAdd).toBe(true);
    expect(plan.lines).toEqual([cat("a", 30), typed("Unknown tonic", 2), cat("a", 5, "box")]);
  });

  it("cannot add when nothing is selected", () => {
    expect(planAdd(rows, EMPTY_SELECTION)).toEqual({ lines: [], invalid: [], canAdd: false });
  });

  it("cannot add while any selected quantity is invalid, and names that row", () => {
    let sel = toggleRow(toggleRow(EMPTY_SELECTION, rows[0]!), rows[1]!);
    for (const bad of ["", "0", "-1", "1.5", "100001", "abc"]) {
      const plan = planAdd(rows, setQuantityText(sel, 1, bad));
      expect(plan.canAdd, bad).toBe(false);
      expect(plan.invalid, bad).toEqual([1]);
    }
    sel = setQuantityText(sel, 1, "100000");
    expect(planAdd(rows, sel).canAdd).toBe(true);
    expect(RANGE_TEXT).toContain("1 to 100,000");
  });

  it("carries no price field", () => {
    const sel = toggleRow(EMPTY_SELECTION, rows[0]!);
    expect(JSON.stringify(planAdd(rows, sel).lines)).not.toMatch(/purchase|mrp|cost|margin|profit|snapshot/i);
  });
});
