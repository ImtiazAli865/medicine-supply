import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LinkBodySchema,
  PendingListQuerySchema,
  PendingProductQuerySchema,
  PriceApplyBodySchema,
  PriceQuerySchema,
  RegisterBodySchema,
} from "@/lib/validation/pending";

const id = () => randomUUID();
const registerBase = () => ({ request_id: id(), expected_version: 3, product: { id: id(), name: "Noran 20mg cap", unit: "strip" } });

describe("RegisterBodySchema", () => {
  it("needs only a name and a unit; everything else stays empty", () => {
    const parsed = RegisterBodySchema.parse(registerBase());
    expect(parsed.product).toMatchObject({
      name: "Noran 20mg cap",
      unit: "strip",
      brand: null,
      generic_name: null,
      strength: null,
      dosage_form: null,
      manufacturer: null,
      pack_size: null,
      sku: null,
      purchase_price: null,
      selling_price: null,
      mrp: null,
    });
    expect(parsed.confirm_similar).toBe(false);
    expect(parsed.apply_price).toBe(false);
  });

  it("turns empty strings into null and trims text, never defaulting a price", () => {
    const parsed = RegisterBodySchema.parse({ ...registerBase(), product: { ...registerBase().product, strength: "  ", manufacturer: " GSK ", selling_price: "" } });
    expect(parsed.product.strength).toBeNull();
    expect(parsed.product.manufacturer).toBe("GSK");
    expect(parsed.product.selling_price).toBeNull();
  });

  it("refuses an empty name or unit with a message on that field", () => {
    const noName = RegisterBodySchema.safeParse({ ...registerBase(), product: { id: id(), name: "  ", unit: "strip" } });
    expect(noName.success).toBe(false);
    const noUnit = RegisterBodySchema.safeParse({ ...registerBase(), product: { id: id(), name: "X", unit: "" } });
    expect(noUnit.success).toBe(false);
    if (!noUnit.success) expect(noUnit.error.issues[0].path).toEqual(["product", "unit"]);
  });

  it("refuses a unit longer than 50 characters and a name longer than 200", () => {
    expect(RegisterBodySchema.safeParse({ ...registerBase(), product: { id: id(), name: "X", unit: "u".repeat(51) } }).success).toBe(false);
    expect(RegisterBodySchema.safeParse({ ...registerBase(), product: { id: id(), name: "n".repeat(201), unit: "strip" } }).success).toBe(false);
  });

  it("refuses negative, over-precise and non-numeric money", () => {
    for (const bad of ["-1", "12.345", "abc", "1,000.00", "Rs 5"]) {
      const result = RegisterBodySchema.safeParse({ ...registerBase(), product: { ...registerBase().product, selling_price: bad } });
      expect(result.success, bad).toBe(false);
    }
    const ok = RegisterBodySchema.parse({ ...registerBase(), product: { ...registerBase().product, selling_price: "125.5" } });
    expect(ok.product.selling_price).toBe("125.50");
  });

  it("needs a request id, a medicine id and an expected version", () => {
    expect(RegisterBodySchema.safeParse({ ...registerBase(), request_id: "nope" }).success).toBe(false);
    expect(RegisterBodySchema.safeParse({ ...registerBase(), product: { name: "X", unit: "strip" } }).success).toBe(false);
    expect(RegisterBodySchema.safeParse({ ...registerBase(), expected_version: 0 }).success).toBe(false);
    expect(RegisterBodySchema.safeParse({ request_id: id(), product: registerBase().product }).success).toBe(false);
  });
});

describe("LinkBodySchema", () => {
  it("accepts a link with a medicine id and defaults how and apply_price", () => {
    const parsed = LinkBodySchema.parse({ request_id: id(), expected_version: 2, product_id: id() });
    expect(parsed.how).toBe("existing");
    expect(parsed.apply_price).toBe(false);
  });

  it("refuses an unknown how and a bad id", () => {
    expect(LinkBodySchema.safeParse({ request_id: id(), expected_version: 2, product_id: id(), how: "auto" }).success).toBe(false);
    expect(LinkBodySchema.safeParse({ request_id: id(), expected_version: 2, product_id: "x" }).success).toBe(false);
  });
});

describe("price validation", () => {
  const body = (price: string, extra: Record<string, unknown> = {}) => ({ request_id: id(), price, line_ids: [], fill_lines: false, ...extra });

  it("accepts a positive PKR amount and makes it canonical", () => {
    expect(PriceApplyBodySchema.parse(body("125.5")).price).toBe("125.50");
    expect(PriceApplyBodySchema.parse(body("125")).price).toBe("125.00");
    expect(PriceApplyBodySchema.parse(body("0.01")).price).toBe("0.01");
    expect(PriceApplyBodySchema.parse(body("9999999999.99")).price).toBe("9999999999.99");
  });

  it("refuses 0, 0.00, negatives, more than two decimals, separators and text", () => {
    for (const bad of ["0", "0.00", "-5", "12.345", "1,000.00", "Rs 10", "", " ", ".5", "10000000000.00"]) {
      expect(PriceApplyBodySchema.safeParse(body(bad)).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("gives a message about zero separately from a format message", () => {
    const zero = PriceApplyBodySchema.safeParse(body("0"));
    const format = PriceApplyBodySchema.safeParse(body("12.345"));
    expect(zero.success || zero.error.issues[0].message).toMatch(/greater than zero/);
    expect(format.success || format.error.issues[0].message).toMatch(/two decimals/);
  });

  it("limits the reviewed lines to 1,000 and needs real ids", () => {
    const many = Array.from({ length: 1001 }, () => id());
    expect(PriceApplyBodySchema.safeParse(body("10", { line_ids: many, fill_lines: true })).success).toBe(false);
    expect(PriceApplyBodySchema.safeParse(body("10", { line_ids: Array.from({ length: 1000 }, () => id()), fill_lines: true })).success).toBe(true);
    expect(PriceApplyBodySchema.safeParse(body("10", { line_ids: ["x"], fill_lines: true })).success).toBe(false);
  });

  it("refuses lines when only the price is saved, and needs fill_lines", () => {
    expect(PriceApplyBodySchema.safeParse(body("10", { line_ids: [id()], fill_lines: false })).success).toBe(false);
    expect(PriceApplyBodySchema.safeParse({ request_id: id(), price: "10", line_ids: [] }).success).toBe(false);
  });

  it("validates the preview query the same way", () => {
    expect(PriceQuerySchema.parse({ price: "99.9" }).price).toBe("99.90");
    expect(PriceQuerySchema.safeParse({ price: "0" }).success).toBe(false);
    expect(PriceQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe("list and product queries", () => {
  it("applies defaults and limits", () => {
    expect(PendingListQuerySchema.parse({})).toEqual({ q: "", limit: 50, waiting: "0" });
    expect(PendingListQuerySchema.parse({ limit: "20", waiting: "1", cursor: "50" })).toMatchObject({ limit: 20, waiting: "1", cursor: "50" });
    expect(PendingListQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(PendingListQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(PendingListQuerySchema.safeParse({ q: "x".repeat(201) }).success).toBe(false);
    expect(PendingListQuerySchema.safeParse({ waiting: "yes" }).success).toBe(false);
  });

  it("needs a real medicine id for the candidates query", () => {
    expect(PendingProductQuerySchema.safeParse({ product_id: id() }).success).toBe(true);
    expect(PendingProductQuerySchema.safeParse({ product_id: "nope" }).success).toBe(false);
    expect(PendingProductQuerySchema.safeParse({}).success).toBe(false);
  });
});
