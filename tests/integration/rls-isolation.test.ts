import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProduct, getProduct, listProducts, updateProduct } from "@/lib/products/repository";
import { createStore, getStore, listStores, updateStore } from "@/lib/stores/repository";
import { ProductCreateSchema, ProductUpdateSchema } from "@/lib/validation/product";
import { ListQuerySchema, StoreCreateSchema, StoreUpdateSchema } from "@/lib/validation/store";
import { anonClient, createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// SC-003: two real businesses on a real Supabase project, each signed in as their own user.
// Neither may list, read, change or deactivate the other's records, by any route.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

suite("Row Level Security isolation on Supabase", () => {
  let a: TestTenant;
  let b: TestTenant;
  let bStoreId: string;
  let bProductId: string;

  beforeAll(async () => {
    a = await createTenant("rls-a");
    b = await createTenant("rls-b");
    bStoreId = (await createStore(b.client, StoreCreateSchema.parse({ id: randomUUID(), name: "B Secret Store" }))).store.id;
    bProductId = (
      await createProduct(b.client, ProductCreateSchema.parse({ id: randomUUID(), name: "B Secret Product", unit: "strip", selling_price: "10" }))
    ).result.product.id;
    await createStore(a.client, StoreCreateSchema.parse({ id: randomUUID(), name: "A Own Store" }));
  }, 60_000);

  afterAll(async () => {
    await deleteTenant(a);
    await deleteTenant(b);
  }, 60_000);

  it("A's lists never contain B's rows", async () => {
    const stores = await listStores(a.client, ListQuerySchema.parse({ status: "all" }));
    expect(stores.items.map((s) => s.name)).toEqual(["A Own Store"]);
    const products = await listProducts(a.client, ListQuerySchema.parse({ status: "all", q: "secret" }));
    expect(products.items).toEqual([]);
  });

  it("A cannot read B's rows by id", async () => {
    expect(await getStore(a.client, bStoreId)).toBeNull();
    expect(await getProduct(a.client, bProductId)).toBeNull();
  });

  it("A cannot update or deactivate B's rows, and B's data is unchanged", async () => {
    await expect(
      updateStore(a.client, bStoreId, StoreUpdateSchema.parse({ expected_version: 1, name: "hacked", is_active: false })),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      updateProduct(a.client, bProductId, ProductUpdateSchema.parse({ expected_version: 1, name: "hacked", is_active: false })),
    ).rejects.toMatchObject({ code: "not_found" });

    const store = await getStore(b.client, bStoreId);
    const product = await getProduct(b.client, bProductId);
    expect(store).toMatchObject({ name: "B Secret Store", is_active: true, version: 1 });
    expect(product).toMatchObject({ name: "B Secret Product", is_active: true, version: 1 });
  });

  it("A cannot create a row using an id that exists in B (generic error, nothing leaked)", async () => {
    const store = await createStore(a.client, StoreCreateSchema.parse({ id: bStoreId, name: "Steal" })).catch((e) => e);
    expect(store).toMatchObject({ code: "validation_error", fields: { id: "This id cannot be used." } });
    expect(JSON.stringify(store)).not.toContain("B Secret");

    const product = await createProduct(a.client, ProductCreateSchema.parse({ id: bProductId, name: "Steal", unit: "strip" })).catch((e) => e);
    expect(product).toMatchObject({ code: "validation_error", fields: { id: "This id cannot be used." } });
    expect(JSON.stringify(product)).not.toContain("B Secret");
  });

  it("A cannot insert a row into B's business or move its own row there", async () => {
    const forged = await a.client.from("stores").insert({ id: randomUUID(), name: "Forged", business_id: b.businessId });
    expect(forged.error).not.toBeNull();

    const own = (await createStore(a.client, StoreCreateSchema.parse({ id: randomUUID(), name: "Movable" }))).store;
    const moved = await a.client.from("stores").update({ business_id: b.businessId }).eq("id", own.id);
    expect(moved.error).not.toBeNull();
    const check = await getStore(a.client, own.id);
    expect(check).not.toBeNull();
  });

  it("no one can delete rows", async () => {
    const own = (await createStore(a.client, StoreCreateSchema.parse({ id: randomUUID(), name: "Undeletable" }))).store;
    const deleted = await a.client.from("stores").delete().eq("id", own.id).select();
    // Either the privilege is missing (error) or no row was affected; the row must still exist.
    expect(deleted.error !== null || (deleted.data ?? []).length === 0).toBe(true);
    expect(await getStore(a.client, own.id)).not.toBeNull();
    const productDelete = await a.client.from("products").delete().neq("id", randomUUID()).select();
    expect(productDelete.error !== null || (productDelete.data ?? []).length === 0).toBe(true);
  });

  it("signed-out requests return nothing and cannot write", async () => {
    const anon = anonClient();
    const stores = await anon.from("stores").select("id");
    expect(stores.error !== null || (stores.data ?? []).length === 0).toBe(true);
    const products = await anon.from("products").select("id");
    expect(products.error !== null || (products.data ?? []).length === 0).toBe(true);
    const insert = await anon.from("stores").insert({ id: randomUUID(), name: "Anon" });
    expect(insert.error).not.toBeNull();
  });

  it("each user sees only their own business and profile rows", async () => {
    const businesses = await a.client.from("businesses").select("id");
    expect((businesses.data ?? []).map((r) => r.id)).toEqual([a.businessId]);
    const profiles = await a.client.from("profiles").select("user_id");
    expect((profiles.data ?? []).map((r) => r.user_id)).toEqual([a.userId]);
    const write = await a.client.from("businesses").update({ name: "renamed" }).eq("id", a.businessId).select();
    expect(write.error !== null || (write.data ?? []).length === 0).toBe(true);
  });

  it("an account without a business sees and creates nothing", async () => {
    const orphan = await createTenant("rls-orphan", false);
    try {
      const stores = await orphan.client.from("stores").select("id");
      expect(stores.error).toBeNull();
      expect(stores.data).toEqual([]);
      const insert = await orphan.client.from("stores").insert({ id: randomUUID(), name: "Nobody" });
      expect(insert.error).not.toBeNull();
    } finally {
      await deleteTenant(orphan);
    }
  });
});
