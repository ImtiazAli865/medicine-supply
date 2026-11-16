import { formatInvoiceMoney } from "@/lib/invoices/status";
import type { AdjustmentDirection, EntryType, OpeningDirection, PaymentStatus } from "./types";

// Labels and small helpers shared by the store account screens, the statement, the invoice screens and the tests.
// A balance is a signed money string: positive = the store owes the supplier, negative = an advance.

export const ENTRY_TYPE_LABEL: Record<EntryType, string> = {
  opening_balance: "Opening balance",
  invoice: "Invoice",
  payment: "Payment",
  adjustment: "Adjustment",
  reversal: "Reversal",
};

/** The one mapping from the data values to the words on the screen (the spec says "partially paid"). */
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  partially_paid: "Partly paid",
  paid: "Paid",
};

export const NOT_IN_ACCOUNT_LABEL = "Not in the account";

export const OPENING_DIRECTION_LABEL: Record<OpeningDirection, string> = {
  owes: "The store owes me",
  advance: "The store paid in advance",
};

export const ADJUSTMENT_DIRECTION_LABEL: Record<AdjustmentDirection, string> = {
  reduce: "Reduce what the store owes",
  increase: "Increase what the store owes",
};

export const MAX_REASON_LENGTH = 500;
export const MAX_OPENING_NOTE_LENGTH = 200;
export const MAX_PAYMENT_REFERENCE_LENGTH = 100;

export type BalanceKind = "owes" | "advance" | "settled";

/** Reads a signed balance text such as "-250.00" and says whether the store owes, has an advance or is settled. */
export function balanceKind(balance: string | null | undefined): BalanceKind {
  if (balance === null || balance === undefined) return "settled";
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(balance);
  if (!match) return "settled";
  const zero = /^0+$/.test(match[2]) && match[3] === "00";
  if (zero) return "settled";
  return match[1] === "-" ? "advance" : "owes";
}

/** The balance without its sign, as text ("-250.00" becomes "250.00"). Text only, no arithmetic. */
export function absoluteMoney(balance: string | null | undefined): string | null {
  if (balance === null || balance === undefined) return null;
  const match = /^-?(\d+\.\d{2})$/.exec(balance);
  return match ? match[1] : null;
}

/** "PKR 1,250.50" for a plain amount, and the same for a signed balance with the sign removed. */
export function formatAccountMoney(amount: string | null | undefined): string {
  const absolute = absoluteMoney(amount);
  return formatInvoiceMoney(absolute);
}

/** The headline words for a balance: "Owes PKR 5,000.00", "Advance PKR 2,000.00" or "Settled". */
export function balanceWording(balance: string | null | undefined): string {
  const kind = balanceKind(balance);
  if (kind === "settled") return "Settled";
  const amount = formatAccountMoney(balance);
  return kind === "owes" ? `Owes ${amount}` : `Advance ${amount}`;
}

/** A longer sentence for the account screen. */
export function balanceSentence(balance: string | null | undefined): string {
  const kind = balanceKind(balance);
  if (kind === "settled") return "Nothing is owed on this account.";
  const amount = formatAccountMoney(balance);
  return kind === "owes" ? `This store owes you ${amount}.` : `This store has paid ${amount} in advance.`;
}
