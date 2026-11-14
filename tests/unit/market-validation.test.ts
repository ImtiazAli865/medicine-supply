import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ListQuerySchema, PurchaseQuerySchema, RecordPurchaseBodySchema, VoidPurchaseBodySchema, today } from "@/lib/validation/market";

const id = () => randomUUID();
const base = () => ({ id: id(), product_id: id(), unit: "strip", purchase_date: "2026-11-13", quantity: 20 });

// "now" for these tests: 2026-11-13 12:00 in Pakistan.
const NOW = new Date("2026-11-13T07:00:00Z");

describe("today", () => {
  it("is the Pakistan calendar day", () => {
    expect(today(new Date("2026-11-12T19:30:00Z"))).toBe("2026-11-13"); // 00:30 PKT
    expect(today(new Date("2026-11-12T18:59:00Z"))).toBe("2026-11-12"); // 23:59 PKT
  });
});

describe("ListQuerySchema", () => {
  it("defaults to today (Pakistan), no search, all rows, all stores", () => {
    const parsed = ListQuerySchema(NOW).parse({});
    expect(parsed).toEqual({ date: "2026-11-13", q: "", status: "all", stores: [] });
  });

  it("accepts a real date, a search, a status and comma separated store ids", () => {
    const a = id();
    const b = id();
    const parsed = ListQuerySchema(NOW).parse({ date: "2026-11-01", q: " panadol ", status: "to_buy", stores: `${a},${b}` });
    expect(parsed).toEqual({ date: "2026-11-01", q: "panadol", status: "to_buy", stores: [a, b] });
  });

  it.each([
    ["an impossible date", { date: "2026-02-30" }],
    ["a date in the wrong format", { date: "13-11-2026" }],
    ["an unknown status", { status: "done" }],
    ["a search over 100 characters", { q: "x".repeat(101) }],
    ["a store id that is not a uuid", { stores: "abc" }],
    ["more than 50 stores", { stores: Array.from({ length: 51 }, id).join(",") }],
  ])("refuses %s", (_label, query) => {
    expect(ListQuerySchema(NOW).safeParse(query).success).toBe(false);
  });
});

describe("PurchaseQuerySchema", () => {
  it("needs a product, a unit and a date", () => {
    expect(PurchaseQuerySchema.safeParse({ product: id(), unit: "strip", date: "2026-11-13" }).success).toBe(true);
    expect(PurchaseQuerySchema.safeParse({ product: id(), unit: "", date: "2026-11-13" }).success).toBe(false);
    expect(PurchaseQuerySchema.safeParse({ product: "x", unit: "strip", date: "2026-11-13" }).success).toBe(false);
    expect(PurchaseQuerySchema.safeParse({ product: id(), unit: "strip", date: "nope" }).success).toBe(false);
  });
});

describe("RecordPurchaseBodySchema", () => {
  const schema = () => RecordPurchaseBodySchema(NOW);

  it("needs only the entry id, medicine, unit, date and quantity; the rest stays empty (cost is never defaulted to 0)", () => {
    const parsed = schema().parse(base());
    expect(parsed).toMatchObject({ unit: "strip", quantity: 20, unit_cost: null, supplier_name: null, reference: null });
  });

  it.each([1, 100000])("accepts quantity %i", (quantity) => {
    expect(schema().safeParse({ ...base(), quantity }).success).toBe(true);
  });

  it.each([
    ["0", 0],
    ["100001", 100001],
    ["1.5", 1.5],
    ["-3", -3],
    ["a string", "20"],
    ["missing", undefined],
  ])("refuses quantity %s with the field message", (_label, quantity) => {
    const result = schema().safeParse({ ...base(), quantity });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path[0]).toBe("quantity");
  });

  it("accepts a cost with zero, one or two decimals and turns blanks into null", () => {
    expect(schema().parse({ ...base(), unit_cost: "125" }).unit_cost).toBe("125.00");
    expect(schema().parse({ ...base(), unit_cost: "125.5" }).unit_cost).toBe("125.50");
    expect(schema().parse({ ...base(), unit_cost: "0" }).unit_cost).toBe("0.00");
    expect(schema().parse({ ...base(), unit_cost: "  " }).unit_cost).toBeNull();
    expect(schema().parse({ ...base(), unit_cost: null }).unit_cost).toBeNull();
  });

  it.each(["12.345", "-1", "abc", "1,5", "12345678901"])("refuses the cost %s", (unit_cost) => {
    const result = schema().safeParse({ ...base(), unit_cost });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path[0]).toBe("unit_cost");
  });

  it("trims and limits the unit, supplier and reference", () => {
    expect(schema().parse({ ...base(), unit: "  strip  ", supplier_name: " Karachi Market ", reference: " INV-9 " })).toMatchObject({
      unit: "strip",
      supplier_name: "Karachi Market",
      reference: "INV-9",
    });
    expect(schema().safeParse({ ...base(), unit: "   " }).success).toBe(false);
    expect(schema().safeParse({ ...base(), unit: "x".repeat(51) }).success).toBe(false);
    expect(schema().safeParse({ ...base(), supplier_name: "x".repeat(201) }).success).toBe(false);
    expect(schema().safeParse({ ...base(), reference: "x".repeat(101) }).success).toBe(false);
  });

  it("allows today and earlier days, refuses a future day, an impossible day and a day before 2000", () => {
    expect(schema().safeParse({ ...base(), purchase_date: "2026-11-13" }).success).toBe(true);
    expect(schema().safeParse({ ...base(), purchase_date: "2026-11-01" }).success).toBe(true);
    expect(schema().safeParse({ ...base(), purchase_date: "2000-01-01" }).success).toBe(true);
    expect(schema().safeParse({ ...base(), purchase_date: "2026-11-14" }).success).toBe(false);
    expect(schema().safeParse({ ...base(), purchase_date: "2026-02-30" }).success).toBe(false);
    expect(schema().safeParse({ ...base(), purchase_date: "1999-12-31" }).success).toBe(false);
  });

  it("refuses a missing or malformed entry id and product id", () => {
    expect(schema().safeParse({ ...base(), id: undefined }).success).toBe(false);
    expect(schema().safeParse({ ...base(), id: "x" }).success).toBe(false);
    expect(schema().safeParse({ ...base(), product_id: "x" }).success).toBe(false);
  });
});

describe("VoidPurchaseBodySchema", () => {
  it("needs a reason of 1 to 500 characters after trimming", () => {
    expect(VoidPurchaseBodySchema.parse({ reason: "  typed wrongly " }).reason).toBe("typed wrongly");
    expect(VoidPurchaseBodySchema.safeParse({ reason: "   " }).success).toBe(false);
    expect(VoidPurchaseBodySchema.safeParse({}).success).toBe(false);
    expect(VoidPurchaseBodySchema.safeParse({ reason: "x".repeat(500) }).success).toBe(true);
    expect(VoidPurchaseBodySchema.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
  });
});
