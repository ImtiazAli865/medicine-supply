import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { insertMedicines } from "../helpers/fast";
import { goOffline, goOnline, linesOnServer, ordersOnServer, waitDeviceReady } from "../helpers/offline";
import { serviceClient, type TestTenant } from "../helpers/supabase-test";
import { expect, signIn, test } from "./fixtures";

// US4 of Module 009: a store that is not in the list and a medicine that is not in the catalog never block an order offline; the
// store is created before its orders and nothing typed is thrown away (mobile, 360 px).
test.describe("US4: new stores and typed medicines taken offline", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(150_000);

  async function addStoreOffline(page: Page, name: string) {
    await page.goto("/orders/new");
    await page.getByTestId("add-new-store").click();
    await page.getByLabel("Store name").fill(name);
    await page.getByTestId("save-new-store").click();
    await expect(page.getByTestId("order-store")).toContainText(name.trim());
  }

  async function addTypedLine(page: Page, name: string, quantity: string, unit: string) {
    await page.getByTestId("fast-search").fill(name);
    await page.getByTestId("add-as-typed").click();
    const form = page.getByTestId("typed-form");
    await form.getByLabel("Medicine name").fill(name);
    await form.getByLabel("Quantity").fill(quantity);
    await form.getByLabel("Unit").fill(unit);
    await form.getByTestId("add-typed-line").click();
  }

  async function seedExistingStore(tenant: TestTenant, name: string): Promise<string> {
    const id = randomUUID();
    const { error } = await serviceClient().from("stores").insert({ id, business_id: tenant.businessId, name });
    if (error) throw new Error(error.message);
    return id;
  }

  test("an unknown store typed offline is kept as a new store with its order and typed lines; online the store is created once, then the order, lines exact", async ({ page, context, freshTenant }) => {
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await addStoreOffline(page, "Brand New Offline Store");
    await expect(page.getByTestId("new-store-note")).toContainText("not yet on the server");
    await expect(page.getByTestId("new-store-note")).toContainText("Other devices will not see");
    await addTypedLine(page, "Cough Syrup Special", "3", "bottle");
    await addTypedLine(page, "Rare Injection 5ml", "10", "box");
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "on_device");
    await page.reload();
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    expect(await ordersOnServer(freshTenant)).toHaveLength(0);

    await goOnline(context);
    await page.goto("/orders");
    await expect.poll(async () => (await ordersOnServer(freshTenant)).length, { timeout: 60_000 }).toBe(1);
    const { data: stores } = await serviceClient().from("stores").select("id,name").eq("business_id", freshTenant.businessId!);
    expect(stores!.map((s) => s.name)).toEqual(["Brand New Offline Store"]);
    const order = (await ordersOnServer(freshTenant))[0]!;
    expect(order.store_id).toBe(stores![0]!.id);
    const lines = await linesOnServer(order.id);
    expect(lines.map((l) => [l.name, l.quantity, l.unit, l.product_id])).toEqual([
      ["Cough Syrup Special", 3, "bottle", null],
      ["Rare Injection 5ml", 10, "box", null],
    ]);
    await expect(page.getByTestId("device-store")).toHaveCount(0);
  });

  test("a store with a similar name on the server is put to the supplier as a question; nothing is merged or created until they answer (use the existing store)", async ({ page, context, freshTenant }) => {
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await addStoreOffline(page, "Existing Pharmacy");
    await addTypedLine(page, "Typed A", "2", "strip");
    // the same store was added on the server meanwhile (for example from another phone)
    const existingId = await seedExistingStore(freshTenant, "Existing Pharmacy");
    await goOnline(context);
    await page.goto("/orders");
    const question = page.getByTestId("similar-store-question");
    await expect(question).toBeVisible({ timeout: 60_000 });
    await expect(question).toContainText("Existing Pharmacy");
    const { data: before } = await serviceClient().from("stores").select("id").eq("business_id", freshTenant.businessId!);
    expect(before).toHaveLength(1); // nothing was created or merged
    expect(await ordersOnServer(freshTenant)).toHaveLength(0);

    await question.getByTestId("use-existing-store").click();
    await expect.poll(async () => (await ordersOnServer(freshTenant)).length, { timeout: 60_000 }).toBe(1);
    expect((await ordersOnServer(freshTenant))[0]!.store_id).toBe(existingId);
    const { data: after } = await serviceClient().from("stores").select("id").eq("business_id", freshTenant.businessId!);
    expect(after).toHaveLength(1);
  });

  test("create a new store anyway creates a second store only after the supplier says so", async ({ page, context, freshTenant }) => {
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await addStoreOffline(page, "Twin Pharmacy");
    await addTypedLine(page, "Typed B", "1", "strip");
    await seedExistingStore(freshTenant, "Twin Pharmacy");
    await goOnline(context);
    await page.goto("/orders");
    await expect(page.getByTestId("similar-store-question")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("create-store-anyway").click();
    await expect.poll(async () => (await ordersOnServer(freshTenant)).length, { timeout: 60_000 }).toBe(1);
    const { data: stores } = await serviceClient().from("stores").select("id,name").eq("business_id", freshTenant.businessId!);
    expect(stores).toHaveLength(2);
  });

  test("a store the server refuses keeps its orders waiting with the reason and a Retry; they are never attached to another store", async ({ page, context, freshTenant }) => {
    await seedExistingStore(freshTenant, "Some Other Store");
    await insertMedicines(freshTenant.client, [{ name: "Catalog Med", strength: "5 mg", selling_price: "10.00" }]);
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await addStoreOffline(page, "Long store name ".repeat(13)); // 207 characters: the server allows at most 200
    await addTypedLine(page, "Typed C", "1", "strip");
    await goOnline(context);
    await page.goto("/orders");
    await expect(page.getByTestId("device-store")).toContainText(/at most 200 characters|not valid/i, { timeout: 60_000 });
    await expect(page.getByTestId("device-store").getByTestId("sync-retry")).toBeVisible();
    await expect(page.getByTestId("device-order").first()).toContainText("waiting for its store");
    const orders = await ordersOnServer(freshTenant);
    expect(orders).toHaveLength(0);
  });
});
