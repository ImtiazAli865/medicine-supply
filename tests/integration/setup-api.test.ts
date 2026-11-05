import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProduct } from "@/lib/products/repository";
import { getSettings, saveSettings } from "@/lib/settings/repository";
import { getSetupState, setChecklistDismissed } from "@/lib/setup/repository";
import { createStore } from "@/lib/stores/repository";
import { ChecklistDismissSchema, SettingsUpdateSchema } from "@/lib/validation/settings";
import { ProductCreateSchema } from "@/lib/validation/product";
import { StoreCreateSchema } from "@/lib/validation/store";
import { anonClient, createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// The code behind /api/setup and /api/setup/checklist against a real Supabase test project.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

suite("setup checklist against Supabase", () => {
  let a: TestTenant;
  let b: TestTenant;

  beforeAll(async () => {
    a = await createTenant("setup-a");
    b = await createTenant("setup-b");
  });
  afterAll(async () => {
    await deleteTenant(a);
    await deleteTenant(b);
  });

  it("is all not-done for a brand-new business", async () => {
    expect(await getSetupState(a.client)).toEqual({ details_done: false, stores_done: false, catalog_done: false, dismissed: false });
  });

  it("derives each item from real data, in any order", async () => {
    await createStore(a.client, StoreCreateSchema.parse({ id: randomUUID(), name: "First Store" }));
    expect(await getSetupState(a.client)).toMatchObject({ details_done: false, stores_done: true, catalog_done: false });

    await createProduct(a.client, ProductCreateSchema.parse({ id: randomUUID(), name: "Hand Added", unit: "strip" }));
    expect(await getSetupState(a.client)).toMatchObject({ stores_done: true, catalog_done: true, details_done: false });

    await saveSettings(a.client, SettingsUpdateSchema.parse({ expected_version: 1, name: "Acme", thermal_paper_mm: 80, account_summary_default: false }));
    expect(await getSetupState(a.client)).toMatchObject({ details_done: true, stores_done: true, catalog_done: true });
  });

  it("another business is unaffected", async () => {
    expect(await getSetupState(b.client)).toEqual({ details_done: false, stores_done: false, catalog_done: false, dismissed: false });
  });

  it("dismisses and shows again, persistently, without changing the settings version", async () => {
    const before = (await getSettings(a.client)).version;
    expect((await setChecklistDismissed(a.client, a.businessId!, true)).dismissed).toBe(true);
    expect((await getSettings(a.client)).version).toBe(before);
    // another session of the same user (another device) sees the same state
    const other = anonClient();
    const signedIn = await other.auth.signInWithPassword({ email: a.email, password: a.password });
    expect(signedIn.error).toBeNull();
    expect((await getSetupState(other)).dismissed).toBe(true);
    expect((await setChecklistDismissed(a.client, a.businessId!, false)).dismissed).toBe(false);
    expect((await getSetupState(other)).dismissed).toBe(false);
  });

  it("A cannot dismiss B's checklist", async () => {
    await setChecklistDismissed(a.client, b.businessId!, true); // matches no row for A
    expect((await getSetupState(b.client)).dismissed).toBe(false);
  });

  it("the request body must contain a boolean dismissed", () => {
    expect(ChecklistDismissSchema.safeParse({}).success).toBe(false);
    expect(ChecklistDismissSchema.safeParse({ dismissed: "yes" }).success).toBe(false);
  });

  it("a signed-out client cannot read or change checklist state", async () => {
    const anon = anonClient();
    expect((await anon.from("business_settings").select("checklist_dismissed")).error?.code).toBe("42501");
    expect((await anon.from("business_settings").update({ checklist_dismissed: true }).eq("business_id", a.businessId!)).error?.code).toBe("42501");
  });
});
