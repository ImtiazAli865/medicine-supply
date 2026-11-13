import { z } from "zod";
import { canonicalMoney, isValidMoney, parseMoneyToPaisa } from "@/lib/money";
import { ProductCreateSchema } from "./product";

// Request bodies and queries of the Module 004 API. The server (database functions) decides everything that
// matters; these checks give early, readable messages and refuse malformed input.

/** The register form: the same fields and limits as a new medicine on the Products screen. */
const RegisterProductSchema = ProductCreateSchema.omit({ confirm_similar: true });

export const RegisterBodySchema = z.object({
  request_id: z.uuid("A valid request id is required."),
  expected_version: z.number("expected_version is required.").int().min(1),
  product: RegisterProductSchema,
  confirm_similar: z.boolean().optional().default(false),
  apply_price: z.boolean().optional().default(false),
});

export const LinkBodySchema = z.object({
  request_id: z.uuid("A valid request id is required."),
  expected_version: z.number("expected_version is required.").int().min(1),
  product_id: z.uuid("A valid medicine id is required."),
  how: z.enum(["existing", "proposal"]).optional().default("existing"),
  apply_price: z.boolean().optional().default(false),
});

const PRICE_MESSAGE = "Enter an amount like 125 or 125.50 (at most two decimals).";

/** A selling price typed by the supplier: PKR, greater than zero, at most two decimals. Never defaulted. */
export const PriceSchema = z.string("Enter a price.").transform((value, ctx) => {
  const text = value.trim();
  if (!isValidMoney(text)) {
    ctx.addIssue({ code: "custom", message: PRICE_MESSAGE });
    return z.NEVER;
  }
  const paisa = parseMoneyToPaisa(text);
  if (paisa === null || paisa <= 0) {
    ctx.addIssue({ code: "custom", message: "Enter a price greater than zero." });
    return z.NEVER;
  }
  return canonicalMoney(text) as string;
});

export const PriceApplyBodySchema = z
  .object({
    request_id: z.uuid("A valid request id is required."),
    price: PriceSchema,
    line_ids: z.array(z.uuid("A valid line id is required.")).max(1000, "At most 1,000 lines can be filled at once.").optional().default([]),
    fill_lines: z.boolean("fill_lines is required."),
  })
  .superRefine((value, ctx) => {
    if (!value.fill_lines && value.line_ids.length > 0) {
      ctx.addIssue({ code: "custom", path: ["line_ids"], message: "No lines can be filled when only the price is saved." });
    }
  });

export const PriceQuerySchema = z.object({ price: PriceSchema });

export const PendingProductQuerySchema = z.object({ product_id: z.uuid("A valid medicine id is required.") });

export const PendingListQuerySchema = z.object({
  q: z.string().max(200).optional().default(""),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().max(20).optional(),
  waiting: z.enum(["0", "1"]).optional().default("0"),
});

export type RegisterBody = z.infer<typeof RegisterBodySchema>;
export type LinkBody = z.infer<typeof LinkBodySchema>;
export type PriceApplyBody = z.infer<typeof PriceApplyBodySchema>;
export type PendingListQuery = z.infer<typeof PendingListQuerySchema>;
