import { z } from "zod";

const LIMITS = { name: 200, unit: 50, notes: 1000, reason: 500, lines: 200, quantity: 100000 } as const;

/** Text with leading, trailing and repeated spaces cleaned and nothing else changed. */
const cleanSpaces = (value: string) => value.replace(/\s+/g, " ").trim();

const unit = z
  .string("Enter a unit.")
  .trim()
  .min(1, "Enter a unit.")
  .max(LIMITS.unit, `Unit can be at most ${LIMITS.unit} characters.`);

const quantity = z
  .number("Enter a quantity.")
  .int("Quantity must be a whole number.")
  .min(1, "Quantity must be at least 1.")
  .max(LIMITS.quantity, `Quantity can be at most ${LIMITS.quantity.toLocaleString("en-US")}.`);

/** Optional free text: a missing key, blank text or null becomes null. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} can be at most ${max} characters.`)
    .nullish()
    .transform((v) => (v == null || v === "" ? null : v))
    .default(null);

const LineSchema = z
  .object({
    id: z.uuid("A valid line id is required."),
    product_id: z.uuid("A valid medicine id is required.").nullable(),
    name: z.string().nullish(),
    quantity,
    unit,
  })
  .transform((line, ctx) => {
    // A catalog line takes its description from the medicine on the server; any name sent is ignored.
    if (line.product_id !== null) return { ...line, name: null };
    const name = cleanSpaces(line.name ?? "");
    if (name === "") {
      ctx.addIssue({ code: "custom", path: ["name"], message: "Enter the medicine name." });
      return z.NEVER;
    }
    if (name.length > LIMITS.name) {
      ctx.addIssue({ code: "custom", path: ["name"], message: `Name can be at most ${LIMITS.name} characters.` });
      return z.NEVER;
    }
    return { ...line, name };
  });

export const OrderSaveSchema = z.object({
  request_id: z.uuid("A valid request id is required."),
  // null on the first save (creation); otherwise the version the screen was based on.
  expected_version: z.number("expected_version is required (use null for the first save).").int().min(1).nullable(),
  store_id: z.uuid("Choose a store."),
  notes: optionalText(LIMITS.notes, "Notes"),
  lines: z
    .array(LineSchema)
    .max(LIMITS.lines, `An order can have at most ${LIMITS.lines} lines.`)
    .refine((lines) => new Set(lines.map((l) => l.id)).size === lines.length, "Each line needs its own id."),
});

export const OrderActionSchema = z.object({
  request_id: z.uuid("A valid request id is required."),
  expected_version: z.number("expected_version is required.").int().min(1),
});

export const OrderCancelSchema = OrderActionSchema.extend({
  reason: optionalText(LIMITS.reason, "Reason"),
});

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date form YYYY-MM-DD.")
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
  }, "Enter a real date.");

export const OrderListQuerySchema = z
  .object({
    store_id: z.uuid("Not a valid store.").optional(),
    status: z.enum(["draft", "confirmed", "cancelled"]).optional(),
    from: day.optional(),
    to: day.optional(),
    q: z.string().max(200).optional().default(""),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    cursor: z.string().max(20).optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { path: ["from"], message: "The start date is after the end date." });

export type OrderSaveBody = z.infer<typeof OrderSaveSchema>;
export type OrderActionBody = z.infer<typeof OrderActionSchema>;
export type OrderCancelBody = z.infer<typeof OrderCancelSchema>;
export type OrderListQuery = z.infer<typeof OrderListQuerySchema>;
