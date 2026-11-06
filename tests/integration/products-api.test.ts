import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { createProduct, findProductsByName, getProduct, listProducts, updateProduct } from "@/lib/products/repository";
import { ProductCreateSchema, ProductUpdateSchema } from "@/lib/validation/product";
import { ListQuerySchema } from "@/lib/validation/store";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// Runs the product repository (the code behind /api/products) against a real Supabase test project,
// signed in as a real user, so Row Level Security is in effect. Skipped without test credentials.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const make = (t: TestTenant, fields: Record<string, unknown>) =>
  createProduct(t.client, ProductCreateSchema.parse({ id: randomUUID(), name: "Panadol", unit: "strip", ...fields }));
const list = (t: TestTenant, q = "", status: "active" | "inactive" | "all" = "active") =>
  listProducts(t.client, ListQuerySchema.parse({ q, status }));
const errorOf = async (promise: Promise<unknown>) => (await promise.then(() => null, (e) => e)) as ApiError | null;

suite("products repository against Supabase", () => {
  let a: TestTenant;

  beforeAll(async () => {
    a = await createTenant("products-a");
  });
  afterAll(async () => {
    await deleteTenant(a);
  });

  it("creates a product with only name and unit and invents no values", async () => {
    const { result, created } = await make(a, { name: "Brufen" });
    expect(created).toBe(true);
    const p = result.product;
    expect(p.unit).toBe("strip");
    expect(p.purchase_price).toBeNull();
    expect(p.selling_price).toBeNull();
    expect(p.mrp).toBeNull();
    expect(p.strength).toBeNull();
    expect(p.manufacturer).toBeNull();
    expect(p.unit_gross_profit).toBeNull();
    expect(result.warnings).toEqual([]);
    expect(JSON.stringify(p)).not.toContain("business_id");
  });

  it("stores exact prices and computes unit gross profit exactly", async () => {
    const { result } = await make(a, { name: "Priced", purchase_price: "99.99", selling_price: "125.5", mrp: "130" });
    expect(result.product.purchase_price).toBe("99.99");
    expect(result.product.selling_price).toBe("125.50");
    expect(result.product.mrp).toBe("130.00");
    expect(result.product.unit_gross_profit).toBe("25.51");
    const again = await getProduct(a.client, result.product.id);
    expect(again?.unit_gross_profit).toBe("25.51");
  });

  it("shows no gross profit when a price is missing", async () => {
    const { result } = await make(a, { name: "Half Priced", selling_price: "10" });
    expect(result.product.unit_gross_profit).toBeNull();
  });

  it("returns non-blocking warnings and still saves", async () => {
    const { result } = await make(a, { name: "Warned", purchase_price: "10", selling_price: "9", mrp: "8" });
    expect(result.warnings.sort()).toEqual(["mrp_below_selling", "selling_below_purchase"]);
    expect(result.product.id).toBeTruthy();
  });

  it("is idempotent: 50 repeated saves with the same id create exactly one product", async () => {
    const input = ProductCreateSchema.parse({ id: randomUUID(), name: "Retry Product", unit: "box", confirm_similar: true });
    const results = await Promise.all(Array.from({ length: 50 }, () => createProduct(a.client, input)));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.result.product.id)).size).toBe(1);
  });

  it("blocks an exact duplicate and returns the existing product", async () => {
    const first = await make(a, { name: "Panadol Extra", strength: "500 mg", dosage_form: "Tablet", pack_size: "10", manufacturer: "GSK" });
    const err = await errorOf(
      make(a, { name: "  PANADOL  extra ", strength: "500  MG", dosage_form: "tablet", pack_size: "10", manufacturer: "gsk", unit: "box" }),
    );
    expect(err?.code).toBe("duplicate_product");
    expect((err?.matches as { id: string }[]).map((m) => m.id)).toContain(first.result.product.id);
  });

  it("still blocks a duplicate of an inactive product and flags it inactive", async () => {
    const first = await make(a, { name: "Dormant", strength: "5 mg" });
    await updateProduct(a.client, first.result.product.id, ProductUpdateSchema.parse({ expected_version: 1, is_active: false }));
    const err = await errorOf(make(a, { name: "Dormant", strength: "5 mg" }));
    expect(err?.code).toBe("duplicate_product");
    expect((err?.matches as { is_active: boolean }[])[0].is_active).toBe(false);
  });

  it("needs confirmation for the same name with a different strength, form or pack size, and never merges", async () => {
    const base = await make(a, { name: "Augmentin", strength: "375 mg" });
    const err = await errorOf(make(a, { name: "Augmentin", strength: "625 mg" }));
    expect(err?.code).toBe("similar_products");
    const confirmed = await make(a, { name: "Augmentin", strength: "625 mg", confirm_similar: true });
    expect(confirmed.created).toBe(true);
    expect(confirmed.result.product.id).not.toBe(base.result.product.id);
    expect((await findProductsByName(a.client, "augmentin")).length).toBe(2);
  });

  it("rejects a SKU used by another product and names it", async () => {
    await make(a, { name: "Sku Holder", sku: "ABC-1" });
    const err = await errorOf(make(a, { name: "Someone Else", sku: " abc-1 " }));
    expect(err?.code).toBe("sku_conflict");
    expect(err?.message).toContain("Sku Holder");
  });

  it("refuses a stale edit with a version conflict and keeps the newer data", async () => {
    const { result } = await make(a, { name: "Versioned" });
    await updateProduct(a.client, result.product.id, ProductUpdateSchema.parse({ expected_version: 1, brand: "First" }));
    const err = await errorOf(
      updateProduct(a.client, result.product.id, ProductUpdateSchema.parse({ expected_version: 1, brand: "Stale" })),
    );
    expect(err?.code).toBe("version_conflict");
    expect((await getProduct(a.client, result.product.id))?.brand).toBe("First");
  });

  it("clears an optional field when it is set to blank, and leaves unspecified fields alone", async () => {
    const { result } = await make(a, { name: "Clearing", strength: "1 g", selling_price: "5" });
    const updated = await updateProduct(
      a.client,
      result.product.id,
      ProductUpdateSchema.parse({ expected_version: 1, selling_price: "" }),
    );
    expect(updated.product.selling_price).toBeNull();
    expect(updated.product.strength).toBe("1 g");
  });

  it("deactivates and reactivates without losing data; inactive products leave the default list", async () => {
    const { result } = await make(a, { name: "Toggle Medicine", selling_price: "7" });
    const id = result.product.id;
    const off = await updateProduct(a.client, id, ProductUpdateSchema.parse({ expected_version: 1, is_active: false }));
    expect(off.product.is_active).toBe(false);
    expect((await list(a, "toggle medicine")).items).toHaveLength(0);
    expect((await list(a, "toggle medicine", "inactive")).items).toHaveLength(1);
    const direct = await getProduct(a.client, id);
    expect(direct?.selling_price).toBe("7.00");
    const on = await updateProduct(a.client, id, ProductUpdateSchema.parse({ expected_version: 2, is_active: true }));
    expect(on.product.is_active).toBe(true);
    expect((await list(a, "toggle medicine")).items).toHaveLength(1);
  });

  it("searches name, brand, generic name, strength, manufacturer and SKU by partial text", async () => {
    await make(a, {
      name: "Panadol Cold",
      brand: "Panadol",
      generic_name: "Paracetamol",
      strength: "650mg",
      manufacturer: "GlaxoSmithKline",
      sku: "PAN-77",
    });
    for (const term of ["pan", "PARACET", "650mg", "glaxo", "pan-77", "cold pan"]) {
      const found = await list(a, term);
      expect(found.items.some((p) => p.name === "Panadol Cold"), `term ${term}`).toBe(true);
    }
    expect((await list(a, "zzzz-no-match")).items).toEqual([]);
  });

  it("rejects updating a product that does not exist", async () => {
    const err = await errorOf(updateProduct(a.client, randomUUID(), ProductUpdateSchema.parse({ expected_version: 1, brand: "x" })));
    expect(err?.code).toBe("not_found");
  });
});
