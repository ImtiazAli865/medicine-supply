import { describe, expect, it } from "vitest";
import { AMOUNT_MESSAGE, DATE_MESSAGE, REFERENCE_MESSAGE, validatePaymentInput } from "@/lib/accounts/payment-input";

const TODAY = "2026-11-24";
const ok = { amount: "5000", date: TODAY, reference: "" };

describe("payment input rules (shared by the online dialog and the offline screen)", () => {
  it("accepts a normal payment and writes the amount with two decimals", () => {
    expect(validatePaymentInput(ok, TODAY)).toEqual({ ok: true, value: { amount: "5000.00", date: TODAY, reference: null } });
    expect(validatePaymentInput({ ...ok, amount: " 125.5 " }, TODAY)).toMatchObject({ ok: true, value: { amount: "125.50" } });
    expect(validatePaymentInput({ ...ok, amount: "0.01" }, TODAY)).toMatchObject({ ok: true, value: { amount: "0.01" } });
  });

  it("refuses zero, negative, empty, three decimals, a comma, text and a sign", () => {
    for (const amount of ["0", "0.00", "-5", "", "  ", "1.234", "1,5", "abc", "+5", "5e3"]) {
      expect(validatePaymentInput({ ...ok, amount }, TODAY), amount).toEqual({ ok: false, fields: { amount: AMOUNT_MESSAGE } });
    }
  });

  it("refuses an amount too large for the money type, and accepts the largest one", () => {
    expect(validatePaymentInput({ ...ok, amount: "99999999999" }, TODAY)).toEqual({ ok: false, fields: { amount: AMOUNT_MESSAGE } });
    expect(validatePaymentInput({ ...ok, amount: "9999999999.99" }, TODAY)).toMatchObject({ ok: true });
  });

  it("accepts today and refuses tomorrow, 1999-12-31 and a date that is not a date", () => {
    expect(validatePaymentInput({ ...ok, date: "2026-11-24" }, TODAY).ok).toBe(true);
    expect(validatePaymentInput({ ...ok, date: "2026-11-25" }, TODAY)).toEqual({ ok: false, fields: { date: DATE_MESSAGE } });
    expect(validatePaymentInput({ ...ok, date: "1999-12-31" }, TODAY)).toEqual({ ok: false, fields: { date: DATE_MESSAGE } });
    expect(validatePaymentInput({ ...ok, date: "2000-01-01" }, TODAY).ok).toBe(true);
    for (const date of ["", "24/11/2026", "2026-1-5", "tomorrow"]) {
      expect(validatePaymentInput({ ...ok, date }, TODAY), date).toEqual({ ok: false, fields: { date: DATE_MESSAGE } });
    }
  });

  it("accepts a reference of 100 characters, refuses 101, trims it and turns an empty one into null", () => {
    expect(validatePaymentInput({ ...ok, reference: "x".repeat(100) }, TODAY)).toMatchObject({ ok: true });
    expect(validatePaymentInput({ ...ok, reference: "x".repeat(101) }, TODAY)).toEqual({ ok: false, fields: { reference: REFERENCE_MESSAGE } });
    expect(validatePaymentInput({ ...ok, reference: "  R1  " }, TODAY)).toMatchObject({ ok: true, value: { reference: "R1" } });
    expect(validatePaymentInput({ ...ok, reference: "   " }, TODAY)).toMatchObject({ ok: true, value: { reference: null } });
  });

  it("reports every wrong field at once", () => {
    expect(validatePaymentInput({ amount: "0", date: "2999-01-01", reference: "x".repeat(101) }, TODAY)).toEqual({
      ok: false,
      fields: { amount: AMOUNT_MESSAGE, date: DATE_MESSAGE, reference: REFERENCE_MESSAGE },
    });
  });

  it("uses exactly the words of the online dialog", () => {
    expect(AMOUNT_MESSAGE).toBe("Enter an amount above 0 with at most two decimals.");
    expect(DATE_MESSAGE).toBe("Choose a date up to today.");
    expect(REFERENCE_MESSAGE).toBe("Use at most 100 characters.");
  });
});
