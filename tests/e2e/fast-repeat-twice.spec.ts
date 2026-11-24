import { randomUUID } from "node:crypto";
import type { TestTenant } from "../helpers/supabase-test";
import { addMedicine, createOrder, seedMedicines, seedStore, waitSaved } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";
import { blockDeviceStorage } from "../helpers/offline";

// US1 of Module 008: a double tap, a retry and the cases where the button must not appear (mobile, 360 px).
test.describe("US1: repeat the last order twice, retry and guards", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  async function seedSource(tenant: TestTenant, storeName = "Twice Store") {
    const catalog = await seedMedicines(tenant);
    const storeId = await seedStore(tenant, storeName);
    await createOrder(
      tenant,
      storeId,
      [
        { product_id: catalog.pricedId, quantity: 12, unit: "strip" },
        { product_id: catalog.sellingOnlyId, quantity: 3, unit: "box" },
        { product_id: null, name: "Typed Cough Syrup", quantity: 2, unit: "bottle" },
      ],
      { confirm: true },
    );
    return { catalog, storeId };
  }

  async function open(page: import("@playwright/test").Page, storeName: string) {
    await page.goto("/orders/new");
    await page.getByTestId("store-option").filter({ hasText: storeName }).first().click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?store=/);
  }

  async function draftsOf(tenant: TestTenant, storeId: string) {
    const drafts = await tenant.client.from("orders").select("id").eq("store_id", storeId).eq("status", "draft");
    const ids = (drafts.data ?? []).map((d) => d.id as string);
    const lines = ids.length ? await tenant.client.from("order_lines").select("id,order_id").in("order_id", ids).is("removed_at", null) : { data: [] };
    return { drafts: ids, lines: lines.data ?? [] };
  }

  test("a double tap creates one draft with one copy of each line", async ({ page, freshTenant }) => {
    const { storeId } = await seedSource(freshTenant);
    await signIn(page, freshTenant);
    await open(page, "Twice Store");
    await page.getByTestId("repeat-last-order").dblclick();
    await expect(page.getByTestId("order-line")).toHaveCount(3);
    await waitSaved(page);
    await page.waitForTimeout(500);
    await expect(page.getByTestId("order-line")).toHaveCount(3);
    const { drafts, lines } = await draftsOf(freshTenant, storeId);
    expect(drafts).toHaveLength(1);
    expect(lines).toHaveLength(3);
  });

  test("a failed save keeps the lines on screen, and the retry creates one draft with one copy of each line", async ({ page, freshTenant }) => {
    const { storeId } = await seedSource(freshTenant);
    await blockDeviceStorage(page); // this test checks the online failure state, with no copy kept on the device
    await signIn(page, freshTenant);
    await open(page, "Twice Store");
    let block = true;
    await page.route(/\/api\/orders\/[0-9a-f-]{36}$/, (route) => (block && route.request().method() === "PUT" ? route.abort("failed") : route.continue()));
    await page.getByTestId("repeat-last-order").click();
    await expect(page.getByTestId("order-line")).toHaveCount(3);
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "not_saved", { timeout: 20_000 });
    await expect(page.getByTestId("order-line")).toHaveCount(3);
    block = false;
    await page.getByTestId("save-status").getByRole("button", { name: "Retry" }).click();
    await waitSaved(page);
    const { drafts, lines } = await draftsOf(freshTenant, storeId);
    expect(drafts).toHaveLength(1);
    expect(lines).toHaveLength(3);
  });

  test("an inactive medicine is left out with a message that stays until dismissed", async ({ page, freshTenant }) => {
    const { catalog } = await seedSource(freshTenant);
    await freshTenant.client.from("products").update({ is_active: false }).eq("id", catalog.sellingOnlyId);
    await signIn(page, freshTenant);
    await open(page, "Twice Store");
    await page.getByTestId("repeat-last-order").click();
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    const message = page.getByTestId("repeat-skipped");
    await expect(message).toContainText("Brufen 400mg");
    await expect(message).toContainText("no longer active");
    await waitSaved(page);
    await expect(message).toBeVisible(); // still there after the save
    await page.getByTestId("repeat-skipped-dismiss").click();
    await expect(message).toHaveCount(0);
  });

  test("the button is hidden once the draft has a line and for stores with no confirmed order", async ({ page, freshTenant }) => {
    const { catalog } = await seedSource(freshTenant);
    // another store with only a draft and a cancelled order
    const other = await seedStore(freshTenant, "No History Store");
    const productId = catalog.pricedId;
    await createOrder(freshTenant, other, [{ product_id: productId, quantity: 1, unit: "strip" }]); // a draft
    const cancelled = await createOrder(freshTenant, other, [{ product_id: productId, quantity: 1, unit: "strip" }], { confirm: true });
    const result = await freshTenant.client.rpc("order_cancel", { p_id: cancelled.id, p_request_id: randomUUID(), p_expected_version: cancelled.version, p_reason: "test" });
    expect(result.error).toBeNull();

    await signIn(page, freshTenant);
    await open(page, "No History Store");
    await expect(page.getByTestId("no-lines")).toBeVisible();
    await expect(page.getByTestId("repeat-last-order")).toHaveCount(0);

    await open(page, "Twice Store");
    await expect(page.getByTestId("repeat-last-order")).toBeVisible();
    await addMedicine(page, "pan", "Panadol 500mg");
    await expect(page.getByTestId("repeat-last-order")).toHaveCount(0);
  });
});
