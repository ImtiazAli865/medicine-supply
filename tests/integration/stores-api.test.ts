import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { createStore, findStoresByName, getStore, listStores, updateStore } from "@/lib/stores/repository";
import { ListQuerySchema, StoreCreateSchema, StoreUpdateSchema } from "@/lib/validation/store";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// Runs the store repository (the code behind /api/stores) against a real Supabase test project,
// signed in as a real user, so Row Level Security is in effect. Skipped without test credentials.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const create = (t: TestTenant, fields: Record<string, unknown>) =>
  createStore(t.client, StoreCreateSchema.parse({ id: randomUUID(), ...fields }));
const list = (t: TestTenant, q = "", status: "active" | "inactive" | "all" = "active", limit = 50, cursor?: string) =>
  listStores(t.client, ListQuerySchema.parse({ q, status, limit: String(limit), cursor }));

suite("stores repository against Supabase", () => {
  let a: TestTenant;

  beforeAll(async () => {
    a = await createTenant("stores-a");
  });
  afterAll(async () => {
    await deleteTenant(a);
  });

  it("creates a store with only a name and returns it", async () => {
    const { store, created } = await create(a, { name: "Al Madina Medical" });
    expect(created).toBe(true);
    expect(store.name).toBe("Al Madina Medical");
    expect(store.is_active).toBe(true);
    expect(store.version).toBe(1);
    expect(store.contact_person).toBeNull();
    expect(JSON.stringify(store)).not.toContain("business_id");
  });

  it("is idempotent: 50 repeated saves with the same id create exactly one store", async () => {
    const input = StoreCreateSchema.parse({ id: randomUUID(), name: "Retry Store", confirm_duplicate: true });
    const results = await Promise.all(Array.from({ length: 50 }, () => createStore(a.client, input)));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.store.id)).size).toBe(1);
    const found = await list(a, "retry store", "all");
    expect(found.items.filter((s) => s.id === input.id)).toHaveLength(1);
  });

  it("asks for confirmation when the name matches an existing store, then allows it", async () => {
    await create(a, { name: "Shah Medical" });
    await expect(create(a, { name: "  SHAH   medical " })).rejects.toMatchObject({ code: "similar_store" });
    const again = await create(a, { name: "Shah Medical", confirm_duplicate: true });
    expect(again.created).toBe(true);
  });

  it("searches by partial name, contact person, phone, Urdu text and special characters", async () => {
    await create(a, { name: "Rehman Medical", contact_person: "Imran Khan", phone: "0300-1112223" });
    await create(a, { name: "المدینہ میڈیکل" });
    await create(a, { name: "50% Off Pharmacy" });
    expect((await list(a, "rehm")).items.some((s) => s.name === "Rehman Medical")).toBe(true);
    expect((await list(a, "imran")).items.some((s) => s.name === "Rehman Medical")).toBe(true);
    expect((await list(a, "1112")).items.some((s) => s.name === "Rehman Medical")).toBe(true);
    expect((await list(a, "میڈیکل")).items.length).toBeGreaterThan(0);
    // '%' must match literally, not as a wildcard.
    expect((await list(a, "50%")).items.map((s) => s.name)).toEqual(["50% Off Pharmacy"]);
    expect((await list(a, "'\" ; --")).items).toEqual([]);
  });

  it("pages through every store exactly once", async () => {
    for (let i = 0; i < 7; i++) await create(a, { name: `Paging Store ${String(i).padStart(2, "0")}` });
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list(a, "paging store", "active", 3, cursor);
      seen.push(...page.items.map((s) => s.id));
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it("edits, then deactivates and reactivates; the default list hides inactive stores", async () => {
    const { store } = await create(a, { name: "Toggle Store" });
    const edited = await updateStore(a.client, store.id, StoreUpdateSchema.parse({ expected_version: 1, phone: "111" }));
    expect(edited.phone).toBe("111");
    expect(edited.version).toBe(2);

    const off = await updateStore(a.client, store.id, StoreUpdateSchema.parse({ expected_version: 2, is_active: false }));
    expect(off.is_active).toBe(false);
    expect((await list(a, "toggle store")).items).toHaveLength(0);
    expect((await list(a, "toggle store", "inactive")).items).toHaveLength(1);
    expect((await list(a, "toggle store", "all")).items).toHaveLength(1);

    const on = await updateStore(a.client, store.id, StoreUpdateSchema.parse({ expected_version: 3, is_active: true }));
    expect(on.is_active).toBe(true);
    expect((await list(a, "toggle store")).items).toHaveLength(1);
  });

  it("refuses to overwrite a changed record (version conflict) and returns the current one", async () => {
    const { store } = await create(a, { name: "Conflict Store" });
    await updateStore(a.client, store.id, StoreUpdateSchema.parse({ expected_version: 1, phone: "first" }));
    const attempt = updateStore(a.client, store.id, StoreUpdateSchema.parse({ expected_version: 1, phone: "stale" }));
    await expect(attempt).rejects.toMatchObject({ code: "version_conflict" });
    const error = (await attempt.catch((e) => e)) as ApiError;
    expect((error.current as { phone: string }).phone).toBe("first");
    expect((await getStore(a.client, store.id))?.phone).toBe("first");
  });

  it("finds stores by normalized name for the duplicate warning, excluding the store itself", async () => {
    const { store } = await create(a, { name: "Lookup Store" });
    expect((await findStoresByName(a.client, "  LOOKUP  store")).map((s) => s.id)).toContain(store.id);
    expect(await findStoresByName(a.client, "Lookup Store", store.id)).toEqual([]);
  });

  it("returns not_found when updating a store that does not exist", async () => {
    await expect(
      updateStore(a.client, randomUUID(), StoreUpdateSchema.parse({ expected_version: 1, name: "Ghost" })),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
