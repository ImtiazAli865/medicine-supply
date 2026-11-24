import { describe, expect, it } from "vitest";
import {
  cancelledEntriesSentence,
  excludedSentence,
  figureBadge,
  figureExplanation,
  figureTitle,
  missingSentence,
  NOT_AVAILABLE,
  OFFLINE_MESSAGE,
  profitText,
  purchaseNoCostSentence,
  reasonText,
} from "@/lib/reports/labels";

describe("figure labels", () => {
  it("names the two figures and never mixes them", () => {
    expect(figureTitle("estimated")).toBe("Estimated profit");
    expect(figureTitle("realized")).toBe("Realized profit");
    expect(figureBadge("estimated", "complete")).toBe("Estimate");
    expect(figureBadge("estimated", "incomplete")).toBe("Estimate · Incomplete");
    expect(figureBadge("realized", "complete")).toBe("Realized");
    expect(figureBadge("realized", "incomplete")).toBe("Realized · Incomplete");
  });

  it("explains each figure in a different way", () => {
    expect(figureExplanation("estimated")).not.toBe(figureExplanation("realized"));
    expect(figureExplanation("estimated")).toContain("saved on each order line");
    expect(figureExplanation("realized")).toContain("actual cost");
  });

  it("writes a missing profit as Not available, never as zero", () => {
    expect(profitText(null)).toBe(NOT_AVAILABLE);
    expect(profitText("0.00")).toBe("PKR 0.00");
    expect(profitText("-12.50")).toBe("-PKR 12.50"); // a loss keeps its sign (the shared money formatter writes it first)
    expect(profitText("1250.5")).toContain("1,250.5");
  });
});

describe("sentences and plurals", () => {
  it("says how many lines and how much of the sales have no cost, for 0, 1 and 2", () => {
    expect(missingSentence(0, "100.00")).toBe("");
    expect(missingSentence(1, "550.00")).toBe("1 line (PKR 550.00 of sales) has no cost");
    expect(missingSentence(2, "12500.00")).toBe("2 lines (PKR 12,500.00 of sales) have no cost");
  });

  it("says what was left out of the sales", () => {
    expect(excludedSentence(0, 0)).toBe("");
    expect(excludedSentence(1, 0)).toBe("1 cancelled invoice is not counted.");
    expect(excludedSentence(0, 2)).toBe("2 draft invoices are not counted.");
    expect(excludedSentence(1, 2)).toBe("1 cancelled invoice and 2 draft invoices are not counted.");
  });

  it("describes purchases without a cost and cancelled entries", () => {
    expect(purchaseNoCostSentence(0, 0)).toBe("");
    expect(purchaseNoCostSentence(1, 1)).toContain("1 purchase entry has no cost recorded (1 unit)");
    expect(purchaseNoCostSentence(3, 40)).toContain("3 purchase entries have no cost recorded (40 units)");
    expect(cancelledEntriesSentence(0)).toBe("");
    expect(cancelledEntriesSentence(1)).toBe("1 cancelled purchase entry is left out.");
    expect(cancelledEntriesSentence(2)).toBe("2 cancelled purchase entries are left out.");
  });

  it("has an English reason for every cost-missing reason", () => {
    for (const reason of ["no_purchase_price_saved", "no_purchase_on_market_day", "typed_line", "unit_differs"] as const) {
      expect(reasonText(reason)).toMatch(/^[A-Z].*\.$/);
    }
  });

  it("has a plain offline message", () => {
    expect(OFFLINE_MESSAGE).toContain("need the internet");
  });
});
