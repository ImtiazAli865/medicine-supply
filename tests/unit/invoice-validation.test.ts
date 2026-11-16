import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CancelInvoiceBodySchema,
  CreateInvoiceBodySchema,
  InvoiceListQuerySchema,
  PrintQuerySchema,
  ToInvoiceQuerySchema,
  UpdateQuantitiesBodySchema,
  VersionBodySchema,
} from "@/lib/validation/invoice";

describe("InvoiceListQuerySchema", () => {
  it("fills the defaults when nothing is given", () => {
    expect(InvoiceListQuerySchema.parse({})).toEqual({ status: "all", payment_status: "all", q: "", limit: 20, offset: 0 });
  });

  it("treats empty query values as not given", () => {
    const parsed = InvoiceListQuerySchema.parse({ status: "", payment_status: "", store: "", from: "", to: "", order: "", q: "", limit: "", offset: "" });
    expect(parsed).toEqual({ status: "all", payment_status: "all", q: "", limit: 20, offset: 0 });
  });

  it("reads the filters from string query values", () => {
    const store = randomUUID();
    const order = randomUUID();
    const parsed = InvoiceListQuerySchema.parse({ status: "issued", store, order, from: "2026-11-01", to: "2026-11-14", q: "  INV-12 ", limit: "10", offset: "20" });
    expect(parsed).toMatchObject({ status: "issued", store, order, from: "2026-11-01", to: "2026-11-14", q: "INV-12", limit: 10, offset: 20 });
  });

  it("reads the paid status filter (Module 007)", () => {
    for (const value of ["all", "unpaid", "partially_paid", "paid"]) {
      expect(InvoiceListQuerySchema.parse({ payment_status: value }).payment_status).toBe(value);
    }
  });

  it.each([
    ["an unknown status", { status: "paid" }],
    ["an unknown paid status", { payment_status: "overdue" }],
    ["a store id that is not a UUID", { store: "abc" }],
    ["a date that does not exist", { from: "2026-02-30" }],
    ["a start after the end", { from: "2026-11-14", to: "2026-11-01" }],
    ["a search over 100 characters", { q: "x".repeat(101) }],
    ["a limit of 0", { limit: "0" }],
    ["a limit of 51", { limit: "51" }],
    ["a negative offset", { offset: "-1" }],
    ["a fractional limit", { limit: "2.5" }],
  ])("refuses %s", (_label, query) => {
    expect(InvoiceListQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe("ToInvoiceQuerySchema", () => {
  it("has defaults and limits like the list", () => {
    expect(ToInvoiceQuerySchema.parse({})).toEqual({ q: "", limit: 20, offset: 0 });
    expect(ToInvoiceQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
  });
});

describe("CreateInvoiceBodySchema", () => {
  it("needs two UUIDs", () => {
    expect(CreateInvoiceBodySchema.safeParse({ id: randomUUID(), order_id: randomUUID() }).success).toBe(true);
    expect(CreateInvoiceBodySchema.safeParse({ id: "x", order_id: randomUUID() }).success).toBe(false);
    expect(CreateInvoiceBodySchema.safeParse({ id: randomUUID() }).success).toBe(false);
  });
});

describe("VersionBodySchema", () => {
  it("needs a whole version of 1 or more", () => {
    expect(VersionBodySchema.safeParse({ expected_version: 3 }).success).toBe(true);
    for (const bad of [0, -1, 1.5, "3", null, undefined]) {
      expect(VersionBodySchema.safeParse({ expected_version: bad }).success, String(bad)).toBe(false);
    }
  });
});

describe("UpdateQuantitiesBodySchema", () => {
  const line = (quantity: unknown, id: string = randomUUID()) => ({ line_id: id, delivered_quantity: quantity });

  it("accepts 0, a normal quantity and the maximum", () => {
    for (const quantity of [0, 8, 100000]) {
      expect(UpdateQuantitiesBodySchema.safeParse({ expected_version: 1, lines: [line(quantity)] }).success, String(quantity)).toBe(true);
    }
  });

  it.each([
    ["a negative quantity", -1],
    ["a quantity over 100,000", 100001],
    ["a fraction", 1.5],
    ["a string", "8"],
    ["null", null],
  ])("refuses %s", (_label, quantity) => {
    expect(UpdateQuantitiesBodySchema.safeParse({ expected_version: 1, lines: [line(quantity)] }).success).toBe(false);
  });

  it("refuses no lines, more than 200 lines and a line listed twice", () => {
    expect(UpdateQuantitiesBodySchema.safeParse({ expected_version: 1, lines: [] }).success).toBe(false);
    const many = Array.from({ length: 201 }, () => line(1));
    expect(UpdateQuantitiesBodySchema.safeParse({ expected_version: 1, lines: many }).success).toBe(false);
    const id = randomUUID();
    expect(UpdateQuantitiesBodySchema.safeParse({ expected_version: 1, lines: [line(1, id), line(2, id)] }).success).toBe(false);
  });

  it("refuses a line id that is not a UUID and a missing version", () => {
    expect(UpdateQuantitiesBodySchema.safeParse({ expected_version: 1, lines: [line(1, "nope")] }).success).toBe(false);
    expect(UpdateQuantitiesBodySchema.safeParse({ lines: [line(1)] }).success).toBe(false);
  });
});

describe("CancelInvoiceBodySchema", () => {
  it("trims the reason and needs 1 to 500 characters", () => {
    expect(CancelInvoiceBodySchema.parse({ reason: "  Wrong store  " })).toEqual({ reason: "Wrong store" });
    expect(CancelInvoiceBodySchema.safeParse({ reason: "x".repeat(500) }).success).toBe(true);
    expect(CancelInvoiceBodySchema.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
  });

  it("refuses an empty, spaces-only or missing reason", () => {
    for (const bad of ["", "   ", undefined, null]) {
      expect(CancelInvoiceBodySchema.safeParse({ reason: bad }).success, String(bad)).toBe(false);
    }
  });
});

describe("PrintQuerySchema", () => {
  it("defaults to A4 and accepts thermal", () => {
    expect(PrintQuerySchema.parse({})).toEqual({ layout: "a4" });
    expect(PrintQuerySchema.parse({ layout: "thermal" })).toEqual({ layout: "thermal" });
    expect(PrintQuerySchema.safeParse({ layout: "receipt" }).success).toBe(false);
  });
});
