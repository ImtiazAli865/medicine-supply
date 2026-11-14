import { describe, expect, it } from "vitest";
import { blockerText, invoiceHeading, numberLabel, parseLayout, PRINT_LAYOUT_LABEL } from "@/lib/invoices/status";

describe("numberLabel", () => {
  it("pads the invoice number to six digits with a fixed prefix", () => {
    expect(numberLabel(1)).toBe("INV-000001");
    expect(numberLabel(12)).toBe("INV-000012");
    expect(numberLabel(999999)).toBe("INV-999999");
  });

  it("keeps every digit when the number grows past six digits", () => {
    expect(numberLabel(1234567)).toBe("INV-1234567");
  });

  it("is null for a draft (no number yet)", () => {
    expect(numberLabel(null)).toBeNull();
    expect(numberLabel(undefined)).toBeNull();
  });
});

describe("parseLayout", () => {
  it("accepts thermal and treats everything else as A4", () => {
    expect(parseLayout("thermal")).toBe("thermal");
    expect(parseLayout("a4")).toBe("a4");
    expect(parseLayout("A4")).toBe("a4");
    expect(parseLayout("receipt")).toBe("a4");
    expect(parseLayout(undefined)).toBe("a4");
    expect(parseLayout(null)).toBe("a4");
    expect(parseLayout(["thermal", "a4"])).toBe("thermal");
  });

  it("has a label for both layouts", () => {
    expect(PRINT_LAYOUT_LABEL).toEqual({ a4: "A4", thermal: "Thermal" });
  });
});

describe("wording", () => {
  it("tells a typed line to be registered and priced, and a priceless line to get a price", () => {
    expect(blockerText("typed")).toMatch(/not registered/i);
    expect(blockerText("needs_price")).toMatch(/selling price/i);
  });

  it("shows Draft invoice for a draft and the number for an issued or cancelled invoice", () => {
    expect(invoiceHeading("draft", null)).toBe("Draft invoice");
    expect(invoiceHeading("issued", "INV-000003")).toBe("INV-000003");
    expect(invoiceHeading("cancelled", "INV-000003")).toBe("INV-000003");
  });
});
