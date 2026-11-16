import { z } from "zod";
import { MAX_DELIVERED_QUANTITY } from "@/lib/invoices/status";
import { canonicalMoney, parseMoneyToPaisa } from "@/lib/money";
import { isRealDay } from "@/lib/validation/market";

// Queries and request bodies of the Module 006 API. The database functions decide everything that matters (the
// version check, the prices, the number); these checks give early, readable messages and refuse malformed input.

const DayText = z.string("Choose a date.").refine(isRealDay, "Choose a real date.");

/** A query value that is missing or empty means "not given". */
const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

const OptionalDay = z.preprocess(emptyToUndefined, DayText.optional());
const OptionalUuid = z.preprocess(emptyToUndefined, z.uuid("A valid id is required.").optional());

const PageLimit = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int("Use a whole number.").min(1, "Use at least 1.").max(50, "Use at most 50.").optional().default(20),
);
const PageOffset = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int("Use a whole number.").min(0, "Use 0 or more.").optional().default(0),
);

const SearchText = z.string().trim().max(100, "Use at most 100 characters.").optional().default("");

/** GET /api/invoices */
export const InvoiceListQuerySchema = z
  .object({
    status: z.preprocess(emptyToUndefined, z.enum(["all", "draft", "issued", "cancelled"], "Choose all, draft, issued or cancelled.").optional().default("all")),
    payment_status: z.preprocess(
      emptyToUndefined,
      z.enum(["all", "unpaid", "partially_paid", "paid"], "Choose all, unpaid, partially paid or paid.").optional().default("all"),
    ),
    store: OptionalUuid,
    from: OptionalDay,
    to: OptionalDay,
    order: OptionalUuid,
    q: SearchText,
    limit: PageLimit,
    offset: PageOffset,
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "The start date must not be after the end date.",
    path: ["from"],
  });

/** GET /api/invoices/to-invoice */
export const ToInvoiceQuerySchema = z.object({ q: SearchText, limit: PageLimit, offset: PageOffset });

/** POST /api/invoices. The invoice id is created on the device and doubles as the request id. */
export const CreateInvoiceBodySchema = z.object({
  id: z.uuid("A valid request id is required."),
  order_id: z.uuid("A valid order id is required."),
});

const PAYMENT_MESSAGE = "Enter an amount above 0 with at most two decimals.";

/** An optional payment received now: a money string above 0, returned in canonical two-decimal form. */
const PaymentReceived = z
  .string(PAYMENT_MESSAGE)
  .trim()
  .refine((text) => {
    const paisa = parseMoneyToPaisa(text);
    return paisa !== null && paisa > 0;
  }, PAYMENT_MESSAGE)
  .transform((text) => canonicalMoney(text) as string)
  .nullish()
  .transform((value) => value ?? null);

/** POST /api/invoices/{id}/issue: the version, and an optional payment received now (issued together, atomically). */
export const IssueInvoiceBodySchema = z.object({
  expected_version: z.number("Reload the invoice and try again.").int().min(1, "Reload the invoice and try again."),
  payment_received: PaymentReceived.optional().default(null),
});

/** The body of refresh and discard. */
export const VersionBodySchema = z.object({
  expected_version: z.number("Reload the invoice and try again.").int().min(1, "Reload the invoice and try again."),
});

const QUANTITY_MESSAGE = `Enter a whole number from 0 to ${MAX_DELIVERED_QUANTITY.toLocaleString("en-US")}.`;

/** PATCH /api/invoices/{id}: the delivered (billed) quantity of draft lines. */
export const UpdateQuantitiesBodySchema = z
  .object({
    expected_version: z.number("Reload the invoice and try again.").int().min(1, "Reload the invoice and try again."),
    lines: z
      .array(
        z.object({
          line_id: z.uuid("A valid line id is required."),
          delivered_quantity: z
            .number(QUANTITY_MESSAGE)
            .int(QUANTITY_MESSAGE)
            .min(0, QUANTITY_MESSAGE)
            .max(MAX_DELIVERED_QUANTITY, QUANTITY_MESSAGE),
        }),
      )
      .min(1, "Send at least one line.")
      .max(200, "Send at most 200 lines."),
  })
  .refine((body) => new Set(body.lines.map((l) => l.line_id)).size === body.lines.length, {
    message: "A line is listed twice.",
    path: ["lines"],
  });

/** POST /api/invoices/{id}/cancel */
export const CancelInvoiceBodySchema = z.object({
  reason: z.string("Write why this invoice is cancelled.").trim().min(1, "Write why this invoice is cancelled.").max(500, "Use at most 500 characters."),
});

/** The print page query: ?layout=a4|thermal */
export const PrintQuerySchema = z.object({
  layout: z.enum(["a4", "thermal"]).optional().default("a4"),
});

export type InvoiceListQuery = z.infer<typeof InvoiceListQuerySchema>;
export type ToInvoiceQuery = z.infer<typeof ToInvoiceQuerySchema>;
export type CreateInvoiceBody = z.infer<typeof CreateInvoiceBodySchema>;
export type VersionBody = z.infer<typeof VersionBodySchema>;
export type IssueInvoiceBody = z.infer<typeof IssueInvoiceBodySchema>;
export type UpdateQuantitiesBody = z.infer<typeof UpdateQuantitiesBodySchema>;
export type CancelInvoiceBody = z.infer<typeof CancelInvoiceBodySchema>;
