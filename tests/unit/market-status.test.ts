import { describe, expect, it } from "vitest";
import { describeProgress, describeRow, formatDay, shiftDay, statusLabel, statusTone } from "@/lib/market/status";
import type { MarketRow } from "@/lib/market/types";

const row = (overrides: Partial<MarketRow> = {}): MarketRow => ({
  key: "p:strip",
  product_id: "p",
  name: "Panadol",
  typed_name: null,
  strength: "500 mg",
  dosage_form: "tablet",
  pack_size: "10",
  manufacturer: "GSK",
  unit: "strip",
  total_requested: 45,
  shown_requested: 45,
  purchased: 0,
  remaining: 45,
  extra: 0,
  status: "not_bought",
  can_record: true,
  stores: [],
  ...overrides,
});

describe("statusLabel", () => {
  it("uses the wording of the spec", () => {
    expect(statusLabel("not_bought")).toBe("Not bought");
    expect(statusLabel("partly_bought")).toBe("Partly bought");
    expect(statusLabel("fully_bought")).toBe("Fully bought");
    expect(statusLabel("bought_extra")).toBe("Bought extra");
  });

  it("gives a tone that never calls a partial purchase a success", () => {
    expect(statusTone("fully_bought")).toBe("success");
    expect(statusTone("partly_bought")).toBe("warning");
    expect(statusTone("not_bought")).toBe("neutral");
    expect(statusTone("bought_extra")).toBe("warning");
  });
});

describe("describeProgress", () => {
  it("says what is bought and what is still missing", () => {
    expect(describeProgress(row({ purchased: 20, remaining: 25, status: "partly_bought" }))).toBe("20 of 45 strip bought, 25 remaining");
  });

  it("says nothing is bought yet", () => {
    expect(describeProgress(row())).toBe("Nothing bought yet, 45 strip to buy");
  });

  it("says all is bought", () => {
    expect(describeProgress(row({ purchased: 45, remaining: 0, status: "fully_bought" }))).toBe("45 of 45 strip bought");
  });

  it("shows the extra and never a negative remaining number", () => {
    const text = describeProgress(row({ purchased: 50, remaining: 0, extra: 5, status: "bought_extra" }));
    expect(text).toBe("50 of 45 strip bought, 5 extra");
    expect(text).not.toContain("-");
  });

  it("describes a typed row as not yet registered and not bought", () => {
    expect(describeProgress(row({ product_id: null, name: null, typed_name: "Noran", can_record: false, total_requested: 10, remaining: 10 }))).toBe("Not registered yet, 10 strip to buy");
  });
});

describe("describeRow", () => {
  it("joins the strength, form and pack size that exist", () => {
    expect(describeRow(row())).toBe("500 mg · tablet · 10");
    expect(describeRow(row({ strength: null, dosage_form: "syrup", pack_size: null }))).toBe("syrup");
    expect(describeRow(row({ strength: null, dosage_form: null, pack_size: null }))).toBe("");
  });
});

describe("days", () => {
  it("formats a day for the screen", () => {
    expect(formatDay("2026-11-12")).toBe("12 Nov 2026");
    expect(formatDay("2026-01-05")).toBe("5 Jan 2026");
  });

  it("moves a day forward and back across a month and a year", () => {
    expect(shiftDay("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  });
});
