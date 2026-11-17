import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { DiagnosticsQuerySchema, ParseBodySchema } from "@/lib/validation/voice";
import { OrderSaveSchema } from "@/lib/validation/order";

const save = (overrides: Record<string, unknown> = {}) => ({
  request_id: randomUUID(),
  expected_version: null,
  store_id: randomUUID(),
  notes: null,
  lines: [],
  ...overrides,
});

describe("ParseBodySchema", () => {
  it("trims the transcript and accepts the two parsers", () => {
    expect(ParseBodySchema.parse({ transcript: "  Panadol 20 strips  ", parser: "ai" })).toEqual({ transcript: "Panadol 20 strips", parser: "ai" });
    expect(ParseBodySchema.parse({ transcript: "x", parser: "rules" }).parser).toBe("rules");
  });

  it("refuses an empty or blank transcript, a transcript over 2,000 characters and an unknown parser", () => {
    expect(ParseBodySchema.safeParse({ transcript: "", parser: "ai" }).success).toBe(false);
    expect(ParseBodySchema.safeParse({ transcript: "   ", parser: "ai" }).success).toBe(false);
    expect(ParseBodySchema.safeParse({ transcript: "x".repeat(2000), parser: "ai" }).success).toBe(true);
    expect(ParseBodySchema.safeParse({ transcript: "x".repeat(2001), parser: "ai" }).success).toBe(false);
    expect(ParseBodySchema.safeParse({ transcript: "x", parser: "gemini" }).success).toBe(false);
    expect(ParseBodySchema.safeParse({ transcript: "x" }).success).toBe(false);
  });

  it("drops any extra field, such as a price", () => {
    const parsed = ParseBodySchema.parse({ transcript: "x", parser: "ai", price: "125.50", balance: "10.00" });
    expect(Object.keys(parsed).sort()).toEqual(["parser", "transcript"]);
  });
});

describe("DiagnosticsQuerySchema", () => {
  it("defaults to 20 and 0, and bounds the page", () => {
    expect(DiagnosticsQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
    expect(DiagnosticsQuerySchema.parse({ limit: "", offset: "" })).toEqual({ limit: 20, offset: 0 });
    expect(DiagnosticsQuerySchema.parse({ limit: "50", offset: "10" })).toEqual({ limit: 50, offset: 10 });
    expect(DiagnosticsQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(DiagnosticsQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
    expect(DiagnosticsQuerySchema.safeParse({ offset: "-1" }).success).toBe(false);
  });
});

describe("OrderSaveSchema source and spoken text (create only)", () => {
  it("defaults to a manual order with no spoken text", () => {
    const parsed = OrderSaveSchema.parse(save());
    expect(parsed.source).toBe("manual");
    expect(parsed.spoken_text).toBeNull();
  });

  it("accepts a voice order with its spoken text, trimmed", () => {
    const parsed = OrderSaveSchema.parse(save({ source: "voice", spoken_text: "  Panadol 20 strips " }));
    expect(parsed.source).toBe("voice");
    expect(parsed.spoken_text).toBe("Panadol 20 strips");
    expect(OrderSaveSchema.safeParse(save({ source: "voice", spoken_text: "x".repeat(2000) })).success).toBe(true);
  });

  it("refuses a voice order without spoken text, spoken text on a manual order, too long a text and an unknown source", () => {
    expect(OrderSaveSchema.safeParse(save({ source: "voice" })).success).toBe(false);
    expect(OrderSaveSchema.safeParse(save({ source: "voice", spoken_text: "   " })).success).toBe(false);
    expect(OrderSaveSchema.safeParse(save({ source: "manual", spoken_text: "Panadol" })).success).toBe(false);
    expect(OrderSaveSchema.safeParse(save({ spoken_text: "Panadol" })).success).toBe(false);
    expect(OrderSaveSchema.safeParse(save({ source: "voice", spoken_text: "x".repeat(2001) })).success).toBe(false);
    expect(OrderSaveSchema.safeParse(save({ source: "robot", spoken_text: "x" })).success).toBe(false);
  });
});

describe("the new error codes", () => {
  it("carry the documented status codes", () => {
    expect(new ApiError("rate_limited", "x").status).toBe(429);
    expect(new ApiError("ai_busy", "x").status).toBe(503);
    expect(new ApiError("ai_not_configured", "x").status).toBe(503);
    expect(new ApiError("ai_timeout", "x").status).toBe(504);
    expect(new ApiError("ai_invalid", "x").status).toBe(502);
    expect(new ApiError("ai_unavailable", "x").status).toBe(502);
  });
});
