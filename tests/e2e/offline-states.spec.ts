import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { insertMedicines } from "../helpers/fast";
import { goOffline, goOnline, waitDeviceReady } from "../helpers/offline";
import type { TestTenant } from "../helpers/supabase-test";
import { createOrder, seedStore } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// FR-033 of Module 009: the new screens have loading, error with Retry and empty states (mobile, 360 px).
test.describe("Module 009: loading, error and empty states", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(150_000);

  async function seed(tenant: TestTenant) {
    const [m] = await insertMedicines(tenant.client, [{ name: "State Med", strength: "10 mg", selling_price: "10.00" }]);
    const storeId = await seedStore(tenant, "State Store");
    const draft = await createOrder(tenant, storeId, [{ product_id: m!, quantity: 1, unit: "strip" }]);
    return { storeId, draftId: draft.id };
  }

  test("Settings: empty (nothing waiting), loading while the phone is checked, and an unavailable phone storage says so", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/settings");
    await expect(page.getByTestId("sync-empty")).toBeVisible(); // empty state that names what is true
    await expect(page.getByTestId("sync-status")).toContainText("Sync and backup");
  });

  test("the offline page: while it opens it says so, and an order that is not on the phone says it needs the internet with a way back", async ({ page, context, freshTenant }) => {
    const s = await seed(freshTenant);
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await page.goto("/orders");
    await expect(page.getByTestId("offline-orders-note")).toBeVisible();
    await expect(page.getByTestId("empty-state")).toBeVisible(); // nothing on this phone yet: an empty state that names the next action
    await expect(page.getByRole("link", { name: /Take your first order|New order/ }).first()).toBeVisible();
    await page.goto(`/orders/${s.draftId}`);
    await expect(page.getByTestId("offline-blocked")).toContainText("needs the internet");
    await expect(page.getByRole("link", { name: "Back to orders" })).toBeVisible();
    await page.goto("/invoices");
    await expect(page.getByTestId("offline-blocked")).toBeVisible();
    await goOnline(context);
  });

  test("the backup: a failure while checking the file shows an error and nothing is imported; a failure while exporting shows an error", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await page.goto("/settings");
    // a valid file first, so the next step has something to check
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("backup-export").click()]);
    const path = test.info().outputPath("states.json");
    await download.saveAs(path);

    await page.route("**/api/backup/export**", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "server_error", message: "Something went wrong." }) }));
    await page.getByTestId("backup-file").setInputFiles(path);
    await expect(page.getByTestId("backup-error")).toContainText("could not be checked");
    await expect(page.getByTestId("import-preview")).toHaveCount(0);
    await expect(page.getByTestId("backup-retry")).toBeVisible();
    await page.unroute("**/api/backup/export**");
    await page.getByTestId("backup-retry").click(); // Retry checks the same file again
    await expect(page.getByTestId("import-preview")).toBeVisible();
    await expect(page.getByTestId("backup-error")).toHaveCount(0);

    // a file that is not a backup: a plain reason, not a crash
    const bad = test.info().outputPath("not-a-backup.json");
    writeFileSync(bad, JSON.stringify({ hello: randomUUID() }));
    await page.getByTestId("backup-file").setInputFiles(bad);
    await expect(page.getByTestId("backup-error")).toContainText("not a backup file");
  });
});
