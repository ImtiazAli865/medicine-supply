import { z } from "zod";
import { canonicalMoney, isValidMoney } from "@/lib/money";

function parseMoney(value: string | null | undefined, ctx: z.RefinementCtx): string | null {
  if (value == null) return null;
  const text = value.trim();
  if (text === "") return null;
  if (!isValidMoney(text)) {
    ctx.addIssue({
      code: "custom",
      message: "Enter an amount like 125 or 125.50 (no negatives, at most two decimals).",
    });
    return z.NEVER;
  }
  return canonicalMoney(text);
}

/**
 * Optional money field for create. A missing key, empty text or null becomes null (never a default
 * price). A valid amount becomes its canonical two-decimal form, such as "125.50".
 */
export const optionalMoney = z.string().nullish().transform(parseMoney).default(null);

/** Money on update: missing key = unchanged (undefined), blank or null = clear, otherwise validated. */
export const moneyUpdate = z
  .string()
  .nullish()
  .transform((value, ctx) => (value === undefined ? undefined : parseMoney(value, ctx)));
