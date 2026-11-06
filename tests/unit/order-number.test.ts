import { describe, expect, it } from "vitest";
import { formatOrderNumber, parseOrderSearch } from "@/lib/orders/number";

describe("formatOrderNumber", () => {
  it("pads to four digits", () => {
    expect(formatOrderNumber(1)).toBe("ORD-0001");
    expect(formatOrderNumber(12)).toBe("ORD-0012");
    expect(formatOrderNumber(9999)).toBe("ORD-9999");
  });

  it("grows past four digits instead of cutting the number", () => {
    expect(formatOrderNumber(10000)).toBe("ORD-10000");
    expect(formatOrderNumber(123456)).toBe("ORD-123456");
  });
});

describe("parseOrderSearch", () => {
  it("reads the digits of 12, #12 and ORD-0012", () => {
    expect(parseOrderSearch("12")).toBe("12");
    expect(parseOrderSearch("#12")).toBe("12");
    expect(parseOrderSearch("ORD-0012")).toBe("0012");
    expect(parseOrderSearch("  ord 12  ")).toBe("12");
  });

  it("returns null for text that is not an order number", () => {
    expect(parseOrderSearch("")).toBeNull();
    expect(parseOrderSearch("al shifa")).toBeNull();
    expect(parseOrderSearch("12a")).toBeNull();
    expect(parseOrderSearch("ORD-")).toBeNull();
  });
});
