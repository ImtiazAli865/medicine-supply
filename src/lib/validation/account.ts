import { z } from "zod";
import { MAX_OPENING_NOTE_LENGTH, MAX_PAYMENT_REFERENCE_LENGTH, MAX_REASON_LENGTH } from "@/lib/accounts/status";
import { canonicalMoney, parseMoneyToPaisa } from "@/lib/money";
import { todayInPakistan } from "@/lib/orders/dates";
import { isRealDay } from "@/lib/validation/market";

// Queries and request bodies of the Module 007 API. The database functions decide everything that matters (the
// amounts, the dates, the reversal rules, exactly-once); these checks give early, readable messages and refuse
// malformed input. A balance or a status is never accepted from the browser: only amounts, dates and reasons.

/** The earliest entry date the ledger accepts. */
export const EARLIEST_ENTRY_DATE = "2000-01-01";

const AMOUNT_MESSAGE = "Enter an amount above 0 with at most two decimals.";

/** An amount above 0 with at most two decimals, returned in its canonical two-decimal form ("5" becomes "5.00"). */
const Amount = z
  .string(AMOUNT_MESSAGE)
  .trim()
  .refine((text) => {
    const paisa = parseMoneyToPaisa(text);
    return paisa !== null && paisa > 0;
  }, AMOUNT_MESSAGE)
  .transform((text) => canonicalMoney(text) as string);

const DayText = z.string("Choose a date.").refine(isRealDay, "Choose a real date.");

/** A real day that is not in the future (Pakistan time) and not before 2000-01-01. */
const EntryDay = DayText.refine((day) => day >= EARLIEST_ENTRY_DATE, "Choose a date from 2000-01-01 or later.").refine(
  (day) => day <= todayInPakistan(),
  "The date cannot be in the future.",
);

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

const PageLimit = (fallback: number) =>
  z.preprocess(
    emptyToUndefined,
    z.coerce.number().int("Use a whole number.").min(1, "Use at least 1.").max(50, "Use at most 50.").optional().default(fallback),
  );
const PageOffset = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int("Use a whole number.").min(0, "Use 0 or more.").optional().default(0),
);

const SearchText = z.string().trim().max(100, "Use at most 100 characters.").optional().default("");

/** An optional text: a missing key, blank text or null becomes null. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} can be at most ${max} characters.`)
    .nullish()
    .transform((value) => (value == null || value === "" ? null : value))
    .default(null);

const Reason = z
  .string("Write the reason.")
  .trim()
  .min(1, "Write the reason.")
  .max(MAX_REASON_LENGTH, `Use at most ${MAX_REASON_LENGTH} characters.`);

const EntryId = z.uuid("A valid request id is required.");

/** GET /api/accounts */
export const AccountListQuerySchema = z.object({
  q: SearchText,
  only_owing: z.preprocess(
    (value) => (value === "true" || value === "1" ? true : value === "false" || value === "0" || value === "" || value === undefined ? false : value),
    z.boolean("Use true or false."),
  ),
  limit: PageLimit(20),
  offset: PageOffset,
});

/** GET /api/accounts/{storeId}: a page of entries. */
export const AccountQuerySchema = z.object({ limit: PageLimit(30), offset: PageOffset });

/** GET /api/accounts/{storeId}/payment-preview */
export const PaymentPreviewQuerySchema = z.object({ amount: Amount });

/** POST /api/accounts/{storeId}/payments. The id is created on the device once per open form and is the request id. */
export const PaymentBodySchema = z.object({
  id: EntryId,
  amount: Amount,
  date: EntryDay,
  method: z.literal("cash", "Only cash payments can be recorded for now.").optional().default("cash"),
  reference: optionalText(MAX_PAYMENT_REFERENCE_LENGTH, "Reference"),
});

/** POST /api/accounts/{storeId}/opening-balances */
export const OpeningBalanceBodySchema = z.object({
  id: EntryId,
  amount: Amount,
  direction: z.enum(["owes", "advance"], "Choose who owes whom."),
  as_on: EntryDay,
  note: optionalText(MAX_OPENING_NOTE_LENGTH, "Note"),
});

/** POST /api/accounts/{storeId}/adjustments */
export const AdjustmentBodySchema = z.object({
  id: EntryId,
  amount: Amount,
  direction: z.enum(["reduce", "increase"], "Choose reduce or increase."),
  reason: Reason,
  date: z
    .preprocess(emptyToUndefined, EntryDay.nullish())
    .transform((day) => day ?? null)
    .default(null),
});

/** POST /api/accounts/{storeId}/entries/{entryId}/reverse. The id is the id of the new reversal entry. */
export const ReverseBodySchema = z.object({ id: EntryId, reason: Reason });

/** GET /api/accounts/{storeId}/statement */
export const StatementQuerySchema = z
  .object({
    from: DayText,
    to: DayText,
  })
  .refine((query) => query.from <= query.to, { message: "The start date must not be after the end date.", path: ["from"] });

export type AccountListQuery = z.infer<typeof AccountListQuerySchema>;
export type AccountQuery = z.infer<typeof AccountQuerySchema>;
export type PaymentPreviewQuery = z.infer<typeof PaymentPreviewQuerySchema>;
export type PaymentBody = z.infer<typeof PaymentBodySchema>;
export type OpeningBalanceBody = z.infer<typeof OpeningBalanceBodySchema>;
export type AdjustmentBody = z.infer<typeof AdjustmentBodySchema>;
export type ReverseBody = z.infer<typeof ReverseBodySchema>;
export type StatementQuery = z.infer<typeof StatementQuerySchema>;
