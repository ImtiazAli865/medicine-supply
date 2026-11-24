import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { insertMedicines } from "../helpers/fast";
import { goOffline, goOnline, waitDeviceReady } from "../helpers/offline";
import { serviceClient, type TestTenant } from "../helpers/supabase-test";
import { createOrder, seedStore } from "./orders-helpers";
import { expect, signIn, smallTargets, test } from "./fixtures";

// SC-009 of Module 009: every new control is at least 44 x 44 px at 360 px, the page never scrolls sideways, and the bottom
// navigation keeps five items.
test.describe("Module 009: 360 px touch targets", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(240_000);

  async function check(page: Page, label: string) {
    expect(await smallTargets(page), `small targets on ${label}`).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `sideways scroll on ${label}`).toBeLessThanOrEqual(0);
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(5);
  }

  async function seed(tenant: TestTenant) {
    const ids = await insertMedicines(tenant.client, [
      { name: "Target Med One", strength: "10 mg", selling_price: "10.00" },
      { name: "Target Med Two", strength: "20 mg", selling_price: "10.00" },
    ]);
    const storeId = await seedStore(tenant, "Target Store");
    const draft = await createOrder(tenant, storeId, [{ product_id: ids[0]!, quantity: 2, unit: "strip" }]);
    return { ids, storeId, draftId: draft.id };
  }

  test("the indicator, device order and store cards, the Settings section, the conflict panel, the held medicine, the store question and the backup preview", async ({ page, context, freshTenant }) => {
    const s = await seed(freshTenant);
    await signIn(page, freshTenant);
    await page.goto(`/orders/${s.draftId}`);
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await waitDeviceReady(page);
    await check(page, "the order screen with the indicator");

    await goOffline(context);
    await page.reload();
    await check(page, "the offline order screen");
    // a change on the phone that will conflict with a server change
    await page.getByTestId("fast-search").fill("Target Med Two");
    await page.getByTestId("medicine-result").filter({ hasText: "Target Med Two" }).first().click();
    await page.getByTestId("fast-quantity").press("Enter");
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "on_device");
    await check(page, "the order screen with Saved on this device");
    // a new store and an order for it (it will be a similar store), and an order whose medicine becomes inactive
    await page.goto("/orders/new");
    await page.getByTestId("add-new-store").click();
    await page.getByLabel("Store name").fill("Target Newshop");
    await page.getByTestId("save-new-store").click();
    await page.getByTestId("fast-search").fill("Typed Thing");
    await page.getByTestId("add-as-typed").click();
    const form = page.getByTestId("typed-form");
    await form.getByLabel("Quantity").fill("1");
    await form.getByLabel("Unit").fill("box");
    await form.getByTestId("add-typed-line").click();
    await check(page, "the order screen of a new store");

    const { data: current } = await freshTenant.client.rpc("order_get", { p_id: s.draftId });
    await freshTenant.client.rpc("order_save", {
      p_id: s.draftId,
      p_request_id: randomUUID(),
      p_expected_version: current.version,
      p_store_id: s.storeId,
      p_notes: "server change",
      p_lines: [{ id: randomUUID(), product_id: s.ids[1]!, name: null, quantity: 5, unit: "box" }],
    });
    // the same store was added on the server meanwhile, so the server will ask whether it is the same store
    const { error: storeError } = await serviceClient().from("stores").insert({ id: randomUUID(), business_id: freshTenant.businessId, name: "Target Newshop" });
    expect(storeError).toBeNull();
    await goOnline(context);

    await page.goto("/orders");
    await expect(page.getByTestId("similar-store-question")).toBeVisible({ timeout: 60_000 });
    await check(page, "the Orders list with a store question and device orders");
    await page.goto("/settings");
    await expect(page.getByTestId("sync-items")).toBeVisible();
    await check(page, "Settings with the sync section");
    await page.getByTestId("clear-device-data").click();
    await check(page, "the clear device data dialog");
    await page.keyboard.press("Escape");

    await page.goto(`/orders/${s.draftId}`);
    await expect(page.getByTestId("conflict-panel")).toBeVisible({ timeout: 30_000 });
    await check(page, "the conflict panel");
    await page.getByTestId("keep-phone").click();
    await check(page, "the conflict confirmation");
    await page.keyboard.press("Escape");

    // a backup file and its preview
    await page.goto("/settings");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("backup-export").click()]);
    const path = test.info().outputPath("targets.json");
    await download.saveAs(path);
    await page.getByTestId("backup-file").setInputFiles(path);
    await expect(page.getByTestId("import-preview")).toBeVisible();
    await check(page, "the import preview");

    // a held medicine
    await serviceClient().from("products").update({ is_active: false }).eq("id", s.ids[1]!);
    const bad = test.info().outputPath("bad.json");
    writeFileSync(bad, "nope");
    await page.getByTestId("backup-file").setInputFiles(bad);
    await expect(page.getByTestId("backup-error")).toBeVisible();
    await check(page, "the backup error");
  });
});
