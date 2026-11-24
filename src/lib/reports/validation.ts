import { z } from "zod";
import { isRealDay } from "@/lib/validation/market";
import { validatePeriod } from "./period";

// Query strings of the Module 010 report routes. The database refuses the same bad periods again
// (report_check_period); these checks give early, readable messages and refuse malformed input.

const DayText = z.string("Choose a date.").refine(isRealDay, "Choose a real date.");
const Group = z.enum(["day", "week", "month"], "Choose day, week or month.").default("day");
const Search = z.string().trim().max(100, "Use at most 100 characters.").default("");
const Sort = z.enum(["sales", "profit", "name"], "Choose sales, profit or name.").default("sales");
const Limit = z.coerce.number("Use a number from 1 to 50.").int("Use a whole number.").min(1, "Use a number from 1 to 50.").max(50, "Use a number from 1 to 50.").default(20);
const Offset = z.coerce.number("Use a number.").int("Use a whole number.").min(0, "Use 0 or more.").default(0);

function checkPeriod(value: { from: string; to: string }, ctx: z.RefinementCtx, now: Date): void {
  const check = validatePeriod(value, now);
  if (!check.ok) ctx.addIssue({ code: "custom", path: ["to"], message: check.message });
}

/** ?from=&to=&group= (sales and purchases) */
export const SeriesQuerySchema = (now: Date = new Date()) =>
  z.object({ from: DayText, to: DayText, group: Group }).superRefine((v, ctx) => checkPeriod(v, ctx, now));

/** ?from=&to= (cost missing) */
export const PeriodQuerySchema = (now: Date = new Date()) =>
  z.object({ from: DayText, to: DayText }).superRefine((v, ctx) => checkPeriod(v, ctx, now));

/** ?from=&to=&q=&sort=&limit=&offset= (sales by store and by medicine) */
export const ListQuerySchema = (now: Date = new Date()) =>
  z
    .object({ from: DayText, to: DayText, q: Search, sort: Sort, limit: Limit, offset: Offset })
    .superRefine((v, ctx) => checkPeriod(v, ctx, now));

export const REPORT_NAMES = ["sales", "purchases", "stores", "medicines", "cost-missing", "balances"] as const;
export type ReportName = (typeof REPORT_NAMES)[number];

/** ?report=&from=&to=&group=&q=&sort= (CSV). Outstanding balances has no period. */
export const ExportQuerySchema = (now: Date = new Date()) =>
  z
    .object({
      report: z.enum(REPORT_NAMES, "Choose a report to export."),
      from: DayText.optional(),
      to: DayText.optional(),
      group: Group,
      q: Search,
      sort: Sort,
    })
    .superRefine((v, ctx) => {
      if (v.report === "balances") return;
      if (!v.from || !v.to) {
        ctx.addIssue({ code: "custom", path: ["from"], message: "Choose a start date and an end date." });
        return;
      }
      checkPeriod({ from: v.from, to: v.to }, ctx, now);
    });

export type SeriesQuery = z.infer<ReturnType<typeof SeriesQuerySchema>>;
export type PeriodQuery = z.infer<ReturnType<typeof PeriodQuerySchema>>;
export type ListQuery = z.infer<ReturnType<typeof ListQuerySchema>>;
export type ExportQuery = z.infer<ReturnType<typeof ExportQuerySchema>>;
