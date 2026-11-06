import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { priceWarnings, sameIdentity, toProduct } from "@/lib/products/repository";
import { ProductCreateSchema, ProductUpdateSchema } from "@/lib/validation/product";

const base = () => ({ id: randomUUID(), name: "Panadol", unit: "strip" });

describe("ProductCreateSchema", () => {
  it("accepts only name and unit, and invents nothing", () => {
    const p = ProductCreateSchema.parse(base());
    expect(p.purchase_price).toBeNull();
    expect(p.selling_price).toBeNull();
    expect(p.mrp).toBeNull();
    expect(p.strength).toBeNull();
    expect(p.dosage_form).toBeNull();
    expect(p.manufacturer).toBeNull();
    expect(p.pack_size).toBeNull();
    expect(p.sku).toBeNull();
    expect(p.confirm_similar).toBe(false);
  });

  it("requires name and unit", () => {
    expect(ProductCreateSchema.safeParse({ id: randomUUID(), unit: "strip" }).success).toBe(false);
    expect(ProductCreateSchema.safeParse({ id: randomUUID(), name: "X" }).success).toBe(false);
    expect(ProductCreateSchema.safeParse({ ...base(), name: "  " }).success).toBe(false);
    expect(ProductCreateSchema.safeParse({ ...base(), unit: "" }).success).toBe(false);
  });

  it("turns empty optional fields into null", () => {
    const p = ProductCreateSchema.parse({ ...base(), strength: "  ", sku: "", selling_price: "" });
    expect(p.strength).toBeNull();
    expect(p.sku).toBeNull();
    expect(p.selling_price).toBeNull();
  });

  it("canonicalizes prices to two decimals", () => {
    const p = ProductCreateSchema.parse({ ...base(), purchase_price: "99.9", selling_price: "125", mrp: "130.50" });
    expect(p.purchase_price).toBe("99.90");
    expect(p.selling_price).toBe("125.00");
    expect(p.mrp).toBe("130.50");
  });

  it("rejects negative, non-numeric and three-decimal prices", () => {
    for (const bad of ["-1", "abc", "1.234", "1,000", "1e3"]) {
      const result = ProductCreateSchema.safeParse({ ...base(), selling_price: bad });
      expect(result.success, `selling_price ${bad}`).toBe(false);
    }
  });

  it("enforces length limits", () => {
    expect(ProductCreateSchema.safeParse({ ...base(), name: "n".repeat(201) }).success).toBe(false);
    expect(ProductCreateSchema.safeParse({ ...base(), unit: "u".repeat(51) }).success).toBe(false);
    expect(ProductCreateSchema.safeParse({ ...base(), strength: "s".repeat(101) }).success).toBe(false);
    expect(ProductCreateSchema.safeParse({ ...base(), sku: "k".repeat(101) }).success).toBe(false);
  });
});

describe("ProductUpdateSchema", () => {
  it("requires expected_version", () => {
    expect(ProductUpdateSchema.safeParse({ name: "X" }).success).toBe(false);
  });

  it("leaves absent fields undefined and clears fields set to blank or null", () => {
    const p = ProductUpdateSchema.parse({ expected_version: 3, selling_price: "", strength: null });
    expect(p.selling_price).toBeNull();
    expect(p.strength).toBeNull();
    expect(p.mrp).toBeUndefined();
    expect(p.purchase_price).toBeUndefined();
    expect(p.name).toBeUndefined();
  });

  it("validates a price given on update", () => {
    expect(ProductUpdateSchema.safeParse({ expected_version: 1, mrp: "-5" }).success).toBe(false);
    expect(ProductUpdateSchema.parse({ expected_version: 1, mrp: "5.5" }).mrp).toBe("5.50");
  });
});

describe("toProduct and unit gross profit", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    name: "Panadol",
    unit: "strip",
    is_active: true,
    version: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  });

  it("computes selling minus purchase exactly", () => {
    expect(toProduct(row({ purchase_price: "99.99", selling_price: "125.50" })).unit_gross_profit).toBe("25.51");
    expect(toProduct(row({ purchase_price: "0.10", selling_price: "0.30" })).unit_gross_profit).toBe("0.20");
  });

  it("is null when either price is missing", () => {
    expect(toProduct(row({ selling_price: "10.00" })).unit_gross_profit).toBeNull();
    expect(toProduct(row({ purchase_price: "10.00" })).unit_gross_profit).toBeNull();
    expect(toProduct(row()).unit_gross_profit).toBeNull();
  });

  it("accepts money delivered as a number and returns canonical strings", () => {
    const p = toProduct(row({ purchase_price: 99.9, selling_price: 125.5 }));
    expect(p.purchase_price).toBe("99.90");
    expect(p.selling_price).toBe("125.50");
  });

  it("can be negative (selling below purchase)", () => {
    expect(toProduct(row({ purchase_price: "10.00", selling_price: "9.50" })).unit_gross_profit).toBe("-0.50");
  });
});

describe("price warnings (non-blocking)", () => {
  it("warns when selling is below purchase", () => {
    expect(priceWarnings({ purchase_price: "10.00", selling_price: "9.99", mrp: null })).toEqual(["selling_below_purchase"]);
  });

  it("warns when MRP is below selling", () => {
    expect(priceWarnings({ purchase_price: null, selling_price: "10.00", mrp: "9.00" })).toEqual(["mrp_below_selling"]);
  });

  it("does not warn on equal or missing prices", () => {
    expect(priceWarnings({ purchase_price: "10.00", selling_price: "10.00", mrp: "10.00" })).toEqual([]);
    expect(priceWarnings({ purchase_price: null, selling_price: null, mrp: null })).toEqual([]);
  });
});

describe("sameIdentity (duplicate rule)", () => {
  const p = (over: Partial<{ name: string; strength: string | null; dosage_form: string | null; pack_size: string | null; manufacturer: string | null }> = {}) => ({
    name: "Panadol Extra",
    strength: "500 mg",
    dosage_form: "Tablet",
    pack_size: "10",
    manufacturer: "GSK",
    ...over,
  });

  it("ignores case and spacing", () => {
    expect(sameIdentity(p(), p({ name: "  PANADOL   extra", strength: "500  MG", manufacturer: "gsk" }))).toBe(true);
  });

  it("treats a missing value as empty", () => {
    expect(sameIdentity(p({ strength: null }), p({ strength: "" }))).toBe(true);
  });

  it("never matches a different strength, dosage form, pack size or manufacturer", () => {
    expect(sameIdentity(p(), p({ strength: "1000 mg" }))).toBe(false);
    expect(sameIdentity(p(), p({ dosage_form: "Syrup" }))).toBe(false);
    expect(sameIdentity(p(), p({ pack_size: "20" }))).toBe(false);
    expect(sameIdentity(p(), p({ manufacturer: "Abbott" }))).toBe(false);
  });
});
