import { describe, expect, it } from "vitest";
import { lineTotal, orderTotals, totalsLabel } from "@/lib/orders/totals";

describe("lineTotal", () => {
  it("multiplies the quantity by the selling price exactly", () => {
    expect(lineTotal(3, "125.50")).toBe("376.50");
    expect(lineTotal(1, "0.10")).toBe("0.10");
    expect(lineTotal(3, "0.10")).toBe("0.30"); // 0.1 * 3 is 0.30000000000000004 in floating point
    expect(lineTotal(7, "19.99")).toBe("139.93");
  });

  it("keeps full precision at the largest values", () => {
    expect(lineTotal(100000, "9999999999.99")).toBe("999999999999000.00");
    expect(lineTotal(99999, "9999999999.99")).toBe("999989999999000.01");
  });

  it("gives nothing when there is no selling price or the price is not an amount", () => {
    expect(lineTotal(3, null)).toBeNull();
    expect(lineTotal(3, undefined)).toBeNull();
    expect(lineTotal(3, "")).toBeNull();
    expect(lineTotal(3, "abc")).toBeNull();
  });

  it("gives nothing for a quantity that is not a positive whole number", () => {
    expect(lineTotal(0, "10.00")).toBeNull();
    expect(lineTotal(-1, "10.00")).toBeNull();
    expect(lineTotal(1.5, "10.00")).toBeNull();
  });
});

describe("orderTotals", () => {
  it("adds only the lines that have a selling price and counts the others", () => {
    const totals = orderTotals([
      { quantity: 2, selling_price: "125.50" },
      { quantity: 1, selling_price: null },
      { quantity: 4, selling_price: "310.00" },
    ]);
    expect(totals).toEqual({ pricedTotal: "1491.00", pricedLines: 2, unpricedLines: 1, lineCount: 3 });
  });

  it("never counts an unpriced line as a zero price silently: it is reported", () => {
    const totals = orderTotals([{ quantity: 5, selling_price: null }]);
    expect(totals).toEqual({ pricedTotal: "0.00", pricedLines: 0, unpricedLines: 1, lineCount: 1 });
  });

  it("handles an empty order", () => {
    expect(orderTotals([])).toEqual({ pricedTotal: "0.00", pricedLines: 0, unpricedLines: 0, lineCount: 0 });
  });

  it("stays exact for many lines", () => {
    const lines = Array.from({ length: 200 }, () => ({ quantity: 3, selling_price: "0.10" }));
    expect(orderTotals(lines).pricedTotal).toBe("60.00");
  });
});

describe("totalsLabel", () => {
  it("says Total when every line is priced", () => {
    expect(totalsLabel({ pricedTotal: "100.00", pricedLines: 2, unpricedLines: 0, lineCount: 2 })).toEqual({
      heading: "Total",
      note: null,
      hasAnyPrice: true,
    });
  });

  it("says Total of priced lines and how many lines have no selling price", () => {
    expect(totalsLabel({ pricedTotal: "100.00", pricedLines: 2, unpricedLines: 1, lineCount: 3 })).toEqual({
      heading: "Total of priced lines",
      note: "1 line has no selling price",
      hasAnyPrice: true,
    });
    expect(totalsLabel({ pricedTotal: "100.00", pricedLines: 1, unpricedLines: 2, lineCount: 3 }).note).toBe("2 lines have no selling price");
  });

  it("reports that nothing is priced yet", () => {
    expect(totalsLabel({ pricedTotal: "0.00", pricedLines: 0, unpricedLines: 3, lineCount: 3 })).toEqual({
      heading: "Total of priced lines",
      note: "3 lines have no selling price",
      hasAnyPrice: false,
    });
  });
});
