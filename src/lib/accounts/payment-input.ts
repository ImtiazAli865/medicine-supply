import { canonicalMoney, isValidMoney, parseMoneyToPaisa } from "@/lib/money";

// The rules for the amount, the date and the reference of a cash payment, in one pure place. The online Record payment dialog and
// the offline Record payment screen (Module 011) both use it, so the two can never drift apart and the messages are the same.
// The server checks the same rules again (the ledger payment function); these give early, readable messages.

export const MIN_PAYMENT_DAY = "2000-01-01";
export const MAX_PAYMENT_REFERENCE = 100;

export interface PaymentInput {
  amount: string;
  date: string;
  reference: string;
}

export interface ValidPayment {
  /** Canonical two-decimal text, for example "5000.00". */
  amount: string;
  date: string;
  /** Trimmed; null when empty. */
  reference: string | null;
}

export type PaymentFields = Partial<Record<"amount" | "date" | "reference", string>>;

export type PaymentCheck = { ok: true; value: ValidPayment } | { ok: false; fields: PaymentFields };

export const AMOUNT_MESSAGE = "Enter an amount above 0 with at most two decimals.";
export const DATE_MESSAGE = "Choose a date up to today.";
export const REFERENCE_MESSAGE = "Use at most 100 characters.";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `today` is the Pakistan calendar day, YYYY-MM-DD (the caller passes `todayInPakistan()`). */
export function validatePaymentInput(input: PaymentInput, today: string): PaymentCheck {
  const fields: PaymentFields = {};
  const trimmed = input.amount.trim();
  const paisa = isValidMoney(trimmed) ? parseMoneyToPaisa(trimmed) : null;
  if (paisa === null || paisa <= 0) fields.amount = AMOUNT_MESSAGE;
  if (!DAY.test(input.date) || input.date > today || input.date < MIN_PAYMENT_DAY) fields.date = DATE_MESSAGE;
  const reference = input.reference.trim();
  if (input.reference.length > MAX_PAYMENT_REFERENCE) fields.reference = REFERENCE_MESSAGE;
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: { amount: canonicalMoney(trimmed) as string, date: input.date, reference: reference === "" ? null : reference } };
}
