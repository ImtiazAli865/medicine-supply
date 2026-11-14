import { z } from "zod";
import { isUuid } from "@/lib/ids";
import { canonicalMoney, isValidMoney } from "@/lib/money";
import { todayInPakistan } from "@/lib/orders/dates";

// Queries and request bodies of the Module 005 API. The database functions decide everything that matters;
// these checks give early, readable messages and refuse malformed input.

/** Today's Pakistan calendar day, YYYY-MM-DD. */
export const today = (now: Date = new Date()): string => todayInPakistan(now);

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar day written as YYYY-MM-DD. */
export function isRealDay(text: string): boolean {
  const match = DATE_PATTERN.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

const DayText = z.string("Choose a date.").refine(isRealDay, "Choose a real date.");

const QUANTITY_MESSAGE = "Enter a whole number from 1 to 100,000.";
const COST_MESSAGE = "Enter an amount like 125 or 125.50, or leave it empty.";

/** The market list query: ?date=&q=&status=&stores=a,b */
export const ListQuerySchema = (now: Date = new Date()) =>
  z.object({
    date: DayText.optional().default(today(now)),
    q: z.string().trim().max(100, "Use at most 100 characters.").optional().default(""),
    status: z.enum(["all", "to_buy", "bought"], "Choose all, to_buy or bought.").optional().default("all"),
    stores: z
      .string()
      .optional()
      .default("")
      .transform((value, ctx) => {
        const ids = value
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== "");
        if (ids.length > 50) {
          ctx.addIssue({ code: "custom", message: "Choose at most 50 stores." });
          return z.NEVER;
        }
        if (!ids.every(isUuid)) {
          ctx.addIssue({ code: "custom", message: "A store id is not valid." });
          return z.NEVER;
        }
        return ids;
      }),
  });

export const SummaryQuerySchema = (now: Date = new Date()) => z.object({ date: DayText.optional().default(today(now)) });

/** The purchase history query: ?product=&unit=&date= */
export const PurchaseQuerySchema = z.object({
  product: z.uuid("A valid medicine id is required."),
  unit: z.string("Enter the unit.").trim().min(1, "Enter the unit.").max(50, "Use at most 50 characters."),
  date: DayText,
});

const OptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .nullable()
    .optional()
    .transform((value) => (value === undefined || value === null || value === "" ? null : value));

/** The actual unit cost: empty, or PKR with at most two decimals (0 or more). Never defaulted to 0. */
const OptionalCost = z
  .string()
  .nullable()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === null || value.trim() === "") return null;
    const text = value.trim();
    const canonical = isValidMoney(text) ? canonicalMoney(text) : null;
    if (canonical === null) {
      ctx.addIssue({ code: "custom", message: COST_MESSAGE });
      return z.NEVER;
    }
    return canonical;
  });

/** POST /api/purchases. The entry id is created on the device and doubles as the request id. */
export const RecordPurchaseBodySchema = (now: Date = new Date()) =>
  z.object({
    id: z.uuid("A valid request id is required."),
    product_id: z.uuid("A valid medicine id is required."),
    unit: z.string("Enter the unit.").trim().min(1, "Enter the unit.").max(50, "Use at most 50 characters."),
    purchase_date: DayText.refine((d) => d <= today(now) && d >= "2000-01-01", "Choose today or an earlier day."),
    quantity: z.number(QUANTITY_MESSAGE).int(QUANTITY_MESSAGE).min(1, QUANTITY_MESSAGE).max(100000, QUANTITY_MESSAGE),
    unit_cost: OptionalCost,
    supplier_name: OptionalText(200),
    reference: OptionalText(100),
  });

/** POST /api/purchases/{id}/void */
export const VoidPurchaseBodySchema = z.object({
  reason: z.string("Write why this entry is cancelled.").trim().min(1, "Write why this entry is cancelled.").max(500, "Use at most 500 characters."),
});

export type ListQuery = z.infer<ReturnType<typeof ListQuerySchema>>;
export type RecordPurchaseBody = z.infer<ReturnType<typeof RecordPurchaseBodySchema>>;
export type VoidPurchaseBody = z.infer<typeof VoidPurchaseBodySchema>;
export type PurchaseQuery = z.infer<typeof PurchaseQuerySchema>;
