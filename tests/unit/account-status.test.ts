import { describe, expect, it } from "vitest";
import {
  absoluteMoney,
  ADJUSTMENT_DIRECTION_LABEL,
  balanceKind,
  balanceSentence,
  balanceWording,
  ENTRY_TYPE_LABEL,
  formatAccountMoney,
  NOT_IN_ACCOUNT_LABEL,
  OPENING_DIRECTION_LABEL,
  PAYMENT_STATUS_LABEL,
} from "@/lib/accounts/status";

describe("balance reading (positive = the store owes, negative = an advance)", () => {
  it("tells owes, advance and settled apart", () => {
    expect(balanceKind("5000.00")).toBe("owes");
    expect(balanceKind("0.01")).toBe("owes");
    expect(balanceKind("-2000.00")).toBe("advance");
    expect(balanceKind("-0.01")).toBe("advance");
    expect(balanceKind("0.00")).toBe("settled");
    expect(balanceKind("-0.00")).toBe("settled");
    expect(balanceKind(null)).toBe("settled");
    expect(balanceKind(undefined)).toBe("settled");
    expect(balanceKind("abc")).toBe("settled");
  });

  it("removes the sign with text only", () => {
    expect(absoluteMoney("-2000.00")).toBe("2000.00");
    expect(absoluteMoney("2000.00")).toBe("2000.00");
    expect(absoluteMoney("-0.05")).toBe("0.05");
    expect(absoluteMoney("12")).toBeNull();
    expect(absoluteMoney(null)).toBeNull();
  });

  it("formats amounts with the PKR prefix and grouping, without a sign", () => {
    expect(formatAccountMoney("1250.50")).toBe("PKR 1,250.50");
    expect(formatAccountMoney("-2000.00")).toBe("PKR 2,000.00");
    expect(formatAccountMoney("1234567890.12")).toBe("PKR 1,234,567,890.12");
    expect(formatAccountMoney(null)).toBe("—");
    expect(formatAccountMoney("")).toBe("—");
  });

  it("words the headline and the sentence", () => {
    expect(balanceWording("5000.00")).toBe("Owes PKR 5,000.00");
    expect(balanceWording("-2000.00")).toBe("Advance PKR 2,000.00");
    expect(balanceWording("0.00")).toBe("Settled");
    expect(balanceSentence("5000.00")).toBe("This store owes you PKR 5,000.00.");
    expect(balanceSentence("-2000.00")).toBe("This store has paid PKR 2,000.00 in advance.");
    expect(balanceSentence("0.00")).toBe("Nothing is owed on this account.");
  });
});

describe("labels", () => {
  it("maps the data values of the paid statuses to the screen words in one place", () => {
    expect(PAYMENT_STATUS_LABEL).toEqual({ unpaid: "Unpaid", partially_paid: "Partly paid", paid: "Paid" });
    expect(NOT_IN_ACCOUNT_LABEL).toBe("Not in the account");
  });

  it("names every entry type", () => {
    expect(Object.keys(ENTRY_TYPE_LABEL).sort()).toEqual(["adjustment", "invoice", "opening_balance", "payment", "reversal"]);
    expect(ENTRY_TYPE_LABEL.opening_balance).toBe("Opening balance");
  });

  it("names the directions", () => {
    expect(OPENING_DIRECTION_LABEL.owes).toBe("The store owes me");
    expect(OPENING_DIRECTION_LABEL.advance).toBe("The store paid in advance");
    expect(ADJUSTMENT_DIRECTION_LABEL.reduce).toBe("Reduce what the store owes");
    expect(ADJUSTMENT_DIRECTION_LABEL.increase).toBe("Increase what the store owes");
  });
});
