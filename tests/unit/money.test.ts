import { describe, expect, it } from "vitest";
import {
  canonicalMoney,
  compareMoney,
  formatPKR,
  isValidMoney,
  paisaToMoney,
  parseMoneyToPaisa,
  subtractMoney,
} from "@/lib/money";

describe("money parsing", () => {
  it("parses whole and decimal amounts to integer paisa", () => {
    expect(parseMoneyToPaisa("125")).toBe(12500);
    expect(parseMoneyToPaisa("125.5")).toBe(12550);
    expect(parseMoneyToPaisa("125.50")).toBe(12550);
    expect(parseMoneyToPaisa("0.05")).toBe(5);
    expect(parseMoneyToPaisa("0")).toBe(0);
  });

  it("rejects negatives, non-numeric text, three decimals and empty text", () => {
    for (const bad of ["-1", "abc", "1.234", "", " ", "1,000", "1e3", "12345678901", "1."]) {
      expect(parseMoneyToPaisa(bad)).toBeNull();
      expect(isValidMoney(bad)).toBe(false);
    }
  });

  it("accepts the largest NUMERIC(12,2) amount", () => {
    expect(parseMoneyToPaisa("9999999999.99")).toBe(999999999999);
  });
});

describe("money formatting", () => {
  it("formats paisa canonically with two decimals", () => {
    expect(paisaToMoney(12550)).toBe("125.50");
    expect(paisaToMoney(5)).toBe("0.05");
    expect(paisaToMoney(-500)).toBe("-5.00");
    expect(paisaToMoney(0)).toBe("0.00");
  });

  it("canonicalizes valid text and rejects invalid text", () => {
    expect(canonicalMoney("125.5")).toBe("125.50");
    expect(canonicalMoney("7")).toBe("7.00");
    expect(canonicalMoney("1.234")).toBeNull();
  });

  it("formats PKR with grouping and handles missing values", () => {
    expect(formatPKR("1250.5")).toBe("PKR 1,250.50");
    expect(formatPKR("1234567.00")).toBe("PKR 1,234,567.00");
    expect(formatPKR("-12.30")).toBe("-PKR 12.30");
    expect(formatPKR(null)).toBe("—");
    expect(formatPKR("nonsense")).toBe("—");
  });
});

describe("exact arithmetic (no floating point drift)", () => {
  it("subtracts exactly where floats would drift", () => {
    // 0.30 - 0.10 is 0.19999999999999998 in floating point.
    expect(subtractMoney("0.30", "0.10")).toBe("0.20");
    expect(subtractMoney("125.50", "99.99")).toBe("25.51");
    expect(subtractMoney("10.10", "10.20")).toBe("-0.10");
  });

  it("returns null when either price is missing or invalid", () => {
    expect(subtractMoney(null, "5.00")).toBeNull();
    expect(subtractMoney("5.00", undefined)).toBeNull();
    expect(subtractMoney("x", "1.00")).toBeNull();
  });

  it("compares amounts exactly", () => {
    expect(compareMoney("10.00", "9.99")).toBe(1);
    expect(compareMoney("9.99", "10.00")).toBe(-1);
    expect(compareMoney("10.0", "10.00")).toBe(0);
    expect(compareMoney(null, "1.00")).toBeNull();
  });
});
