import { describe, expect, it } from "vitest";
import { todayInPakistan } from "@/lib/orders/dates";
import {
  AccountListQuerySchema,
  AccountQuerySchema,
  AdjustmentBodySchema,
  OpeningBalanceBodySchema,
  PaymentBodySchema,
  PaymentPreviewQuerySchema,
  ReverseBodySchema,
  StatementQuerySchema,
} from "@/lib/validation/account";

const ID = "6f1c1c1e-1f0e-4c1a-9d5e-1a2b3c4d5e6f";

function firstMessage(result: { success: boolean; error?: { issues: Array<{ message: string }> } }): string | undefined {
  return result.error?.issues[0]?.message;
}

describe("amounts", () => {
  it("accepts an amount above 0 with at most two decimals and returns it in canonical form", () => {
    const ok = PaymentPreviewQuerySchema.parse({ amount: "5" });
    expect(ok.amount).toBe("5.00");
    expect(PaymentPreviewQuerySchema.parse({ amount: "125.5" }).amount).toBe("125.50");
    expect(PaymentPreviewQuerySchema.parse({ amount: " 0.01 " }).amount).toBe("0.01");
    expect(PaymentPreviewQuerySchema.parse({ amount: "9999999999.99" }).amount).toBe("9999999999.99");
  });

  it("refuses zero, negative, three decimals, too large, empty and text", () => {
    for (const amount of ["0", "0.00", "-5", "1.234", "10000000000", "", "abc", "1,000", "5 PKR"]) {
      expect(PaymentPreviewQuerySchema.safeParse({ amount }).success, amount).toBe(false);
    }
  });
});

describe("payment body", () => {
  const base = { id: ID, amount: "15000", date: todayInPakistan() };

  it("accepts a payment dated today, defaults the method to cash and cleans the reference", () => {
    const parsed = PaymentBodySchema.parse({ ...base, reference: "  Receipt 12  " });
    expect(parsed.method).toBe("cash");
    expect(parsed.reference).toBe("Receipt 12");
    expect(parsed.amount).toBe("15000.00");
    expect(PaymentBodySchema.parse({ ...base }).reference).toBeNull();
    expect(PaymentBodySchema.parse({ ...base, reference: "   " }).reference).toBeNull();
  });

  it("refuses a future date, a date before 2000 and a date that does not exist", () => {
    expect(PaymentBodySchema.safeParse({ ...base, date: "2999-01-01" }).success).toBe(false);
    expect(PaymentBodySchema.safeParse({ ...base, date: "1999-12-31" }).success).toBe(false);
    expect(PaymentBodySchema.safeParse({ ...base, date: "2026-02-30" }).success).toBe(false);
    expect(PaymentBodySchema.safeParse({ ...base, date: "2000-01-01" }).success).toBe(true);
  });

  it("refuses a method other than cash, a missing id and a reference above 100 characters", () => {
    expect(PaymentBodySchema.safeParse({ ...base, method: "bank_transfer" }).success).toBe(false);
    expect(PaymentBodySchema.safeParse({ ...base, id: "not-a-uuid" }).success).toBe(false);
    expect(PaymentBodySchema.safeParse({ ...base, reference: "x".repeat(101) }).success).toBe(false);
    expect(PaymentBodySchema.safeParse({ ...base, reference: "x".repeat(100) }).success).toBe(true);
  });
});

describe("opening balance body", () => {
  const base = { id: ID, amount: "12000", direction: "owes", as_on: "2026-11-01" };

  it("accepts both directions and an optional note", () => {
    expect(OpeningBalanceBodySchema.parse(base).direction).toBe("owes");
    expect(OpeningBalanceBodySchema.parse({ ...base, direction: "advance" }).direction).toBe("advance");
    expect(OpeningBalanceBodySchema.parse(base).note).toBeNull();
    expect(OpeningBalanceBodySchema.parse({ ...base, note: "  From the paper khata " }).note).toBe("From the paper khata");
  });

  it("refuses an unknown direction, a future day and a note above 200 characters", () => {
    expect(OpeningBalanceBodySchema.safeParse({ ...base, direction: "debit" }).success).toBe(false);
    expect(OpeningBalanceBodySchema.safeParse({ ...base, as_on: "2999-01-01" }).success).toBe(false);
    expect(OpeningBalanceBodySchema.safeParse({ ...base, note: "x".repeat(201) }).success).toBe(false);
  });
});

describe("adjustment body", () => {
  const base = { id: ID, amount: "50", direction: "reduce", reason: "Small amount forgiven" };

  it("accepts a reduce or increase with a reason and an optional date", () => {
    expect(AdjustmentBodySchema.parse(base).date).toBeNull();
    expect(AdjustmentBodySchema.parse({ ...base, direction: "increase" }).direction).toBe("increase");
    expect(AdjustmentBodySchema.parse({ ...base, date: "2026-11-02" }).date).toBe("2026-11-02");
    expect(AdjustmentBodySchema.parse({ ...base, date: "" }).date).toBeNull();
  });

  it("needs a reason of 1 to 500 characters and a known direction", () => {
    expect(AdjustmentBodySchema.safeParse({ ...base, reason: "" }).success).toBe(false);
    expect(AdjustmentBodySchema.safeParse({ ...base, reason: "   " }).success).toBe(false);
    expect(AdjustmentBodySchema.safeParse({ ...base, reason: "x".repeat(501) }).success).toBe(false);
    expect(AdjustmentBodySchema.safeParse({ ...base, reason: "x".repeat(500) }).success).toBe(true);
    expect(AdjustmentBodySchema.safeParse({ ...base, direction: "add" }).success).toBe(false);
    expect(AdjustmentBodySchema.safeParse({ ...base, date: "2999-01-01" }).success).toBe(false);
  });

  it("says what is wrong in plain words", () => {
    expect(firstMessage(AdjustmentBodySchema.safeParse({ ...base, reason: "" }))).toBe("Write the reason.");
  });
});

describe("reverse body", () => {
  it("needs a reason and a valid id", () => {
    expect(ReverseBodySchema.parse({ id: ID, reason: " Wrong store " }).reason).toBe("Wrong store");
    expect(ReverseBodySchema.safeParse({ id: ID, reason: "" }).success).toBe(false);
    expect(ReverseBodySchema.safeParse({ id: "x", reason: "Wrong" }).success).toBe(false);
  });
});

describe("statement and list queries", () => {
  it("refuses a start date after the end date", () => {
    expect(StatementQuerySchema.safeParse({ from: "2026-11-10", to: "2026-11-01" }).success).toBe(false);
    expect(StatementQuerySchema.safeParse({ from: "2026-11-01", to: "2026-11-01" }).success).toBe(true);
    expect(StatementQuerySchema.safeParse({ from: "2026-13-01", to: "2026-11-01" }).success).toBe(false);
  });

  it("reads the list query with defaults and limits", () => {
    const parsed = AccountListQuerySchema.parse({});
    expect(parsed).toEqual({ q: "", only_owing: false, limit: 20, offset: 0 });
    expect(AccountListQuerySchema.parse({ only_owing: "true", limit: "50" }).only_owing).toBe(true);
    expect(AccountListQuerySchema.parse({ only_owing: "1" }).only_owing).toBe(true);
    expect(AccountListQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
    expect(AccountListQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(AccountListQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
    expect(AccountQuerySchema.parse({}).limit).toBe(30);
  });
});
