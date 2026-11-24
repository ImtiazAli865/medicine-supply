import { describe, expect, it } from "vitest";
import { ExportQuerySchema, ListQuerySchema, PeriodQuerySchema, SeriesQuerySchema } from "@/lib/reports/validation";

const NOW = new Date("2026-11-25T07:00:00Z");

function messages(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }): string[] {
  return result.error ? result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) : [];
}

describe("series query (sales and purchases)", () => {
  const schema = SeriesQuerySchema(NOW);

  it("accepts a period and defaults the group to day", () => {
    const parsed = schema.parse({ from: "2026-11-01", to: "2026-11-25" });
    expect(parsed).toEqual({ from: "2026-11-01", to: "2026-11-25", group: "day" });
    expect(schema.parse({ from: "2026-11-01", to: "2026-11-25", group: "week" }).group).toBe("week");
  });

  it("refuses a missing date, a bad group and a bad period with a message that names the field", () => {
    expect(messages(schema.safeParse({ from: "2026-11-01" }))).toContain("to: Choose a date.");
    expect(messages(schema.safeParse({ from: "2026-11-01", to: "2026-11-25", group: "year" }))).toContain("group: Choose day, week or month.");
    expect(messages(schema.safeParse({ from: "2026-11-10", to: "2026-11-01" }))).toContain("to: The end date is before the start date.");
    expect(messages(schema.safeParse({ from: "2026-11-30", to: "2026-12-05" }))).toContain("to: The start date is in the future.");
    expect(messages(schema.safeParse({ from: "2020-01-01", to: "2026-11-25" }))).toContain("to: Choose at most 2 years (731 days).");
    expect(messages(schema.safeParse({ from: "2026-02-30", to: "2026-03-01" }))).toContain("from: Choose a real date.");
  });
});

describe("period query (cost missing)", () => {
  it("needs both dates and a valid period", () => {
    const schema = PeriodQuerySchema(NOW);
    expect(schema.parse({ from: "2026-11-01", to: "2026-11-25" })).toEqual({ from: "2026-11-01", to: "2026-11-25" });
    expect(schema.safeParse({ to: "2026-11-25" }).success).toBe(false);
  });
});

describe("list query (stores and medicines)", () => {
  const schema = ListQuerySchema(NOW);
  const base = { from: "2026-11-01", to: "2026-11-25" };

  it("applies the defaults and trims the search", () => {
    expect(schema.parse(base)).toEqual({ ...base, q: "", sort: "sales", limit: 20, offset: 0 });
    expect(schema.parse({ ...base, q: "  pana ", limit: "50", offset: "100", sort: "profit" })).toEqual({ ...base, q: "pana", sort: "profit", limit: 50, offset: 100 });
  });

  it("refuses an out-of-range limit, a negative offset, a long search and a bad sort", () => {
    expect(schema.safeParse({ ...base, limit: "0" }).success).toBe(false);
    expect(schema.safeParse({ ...base, limit: "51" }).success).toBe(false);
    expect(schema.safeParse({ ...base, limit: "2.5" }).success).toBe(false);
    expect(schema.safeParse({ ...base, offset: "-1" }).success).toBe(false);
    expect(schema.safeParse({ ...base, q: "x".repeat(101) }).success).toBe(false);
    expect(schema.safeParse({ ...base, sort: "cost" }).success).toBe(false);
  });
});

describe("export query", () => {
  const schema = ExportQuerySchema(NOW);

  it("needs a period for every report except balances", () => {
    expect(schema.parse({ report: "sales", from: "2026-11-01", to: "2026-11-25" }).report).toBe("sales");
    expect(schema.safeParse({ report: "sales" }).success).toBe(false);
    expect(schema.safeParse({ report: "sales", from: "2026-11-25", to: "2026-11-01" }).success).toBe(false);
    expect(schema.parse({ report: "balances" }).report).toBe("balances");
  });

  it("refuses an unknown report and a PDF", () => {
    expect(messages(schema.safeParse({ report: "pdf", from: "2026-11-01", to: "2026-11-25" }))).toContain("report: Choose a report to export.");
  });
});
