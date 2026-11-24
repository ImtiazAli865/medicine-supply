import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { insertMedicines } from "../helpers/fast";
import { countOrders, goOffline, goOnline, readJournal, waitDeviceReady } from "../helpers/offline";
import { serviceClient, type TestTenant } from "../helpers/supabase-test";
import { createOrder, seedStore } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US6 of Module 009: the Settings screen shows what is going on (mobile, 360 px).
test.describe("US6: sync status in Settings", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(180_000);

  async function seed(tenant: TestTenant) {
    const ids = await insertMedicines(tenant.client, [
      { name: "Status Med One", strength: "10 mg", selling_price: "10.00" },
      { name: "Status Med Two", strength: "20 mg", selling_price: "10.00" },
      { name: "Status Med Three", strength: "30 mg", selling_price: "10.00" },
    ]);
    const storeId = await seedStore(tenant, "Status Store");
    const draft = await createOrder(tenant, storeId, [{ product_id: ids[0]!, quantity: 2, unit: "strip" }]);
    return { ids, storeId, draftId: draft.id };
  }

  async function newOfflineOrder(page: Page, medicine: string) {
    await page.goto("/orders/new");
    await page.getByTestId("store-option").filter({ hasText: "Status Store" }).first().click();
    await page.getByTestId("fast-search").fill(medicine);
    await page.getByTestId("medicine-result").filter({ hasText: medicine }).first().click();
    await page.getByTestId("fast-quantity").press("Enter");
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "on_device");
  }

  test("with nothing waiting it says so, and after a send it says everything is sent as of the time of the last send and nothing more", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await page.goto("/settings");
    await expect(page.getByTestId("sync-online")).toContainText("Online");
    await expect(page.getByTestId("sync-last")).toContainText("Nothing has been sent from this phone yet");
    await expect(page.getByTestId("sync-empty")).toHaveText("Nothing is waiting on this phone.");
    await expect(page.getByTestId("sync-counts")).toContainText("0 waiting · 0 sending · 0 failed · 0 need a decision");
    await expect(page.getByTestId("sync-cache")).toContainText("Medicine list updated");

    // one order is taken and sent: afterwards the screen reports the time of that send
    await page.goto("/orders/new");
    await page.getByTestId("store-option").filter({ hasText: "Status Store" }).first().click();
    await page.getByTestId("fast-search").fill("Status Med Two");
    await page.getByTestId("medicine-result").filter({ hasText: "Status Med Two" }).first().click();
    await page.getByTestId("fast-quantity").press("Enter");
    await expect.poll(() => countOrders(freshTenant), { timeout: 60_000 }).toBe(2);
    await page.goto("/settings");
    await expect(page.getByTestId("sync-empty")).toContainText("Everything is sent as of");
    await expect(page.getByTestId("sync-last")).toContainText("Last successful send:");
  });

  test("waiting, failed and conflicting orders are counted and listed with their reason; Retry sends the failed one; opening a conflict shows the decision", async ({ page, context, freshTenant }) => {
    const s = await seed(freshTenant);
    await signIn(page, freshTenant);
    await page.goto(`/orders/${s.draftId}`); // a copy of the server draft is kept for the conflict
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await waitDeviceReady(page);
    await goOffline(context);

    // conflicting: the phone changes the server draft, the server changes it too
    await page.reload();
    await page.getByTestId("fast-search").fill("Status Med Two");
    await page.getByTestId("medicine-result").filter({ hasText: "Status Med Two" }).first().click();
    await page.getByTestId("fast-quantity").press("Enter");
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "on_device");
    // failing: an order with a medicine that becomes inactive on the server
    await newOfflineOrder(page, "Status Med Three");
    await serviceClient().from("products").update({ is_active: false }).eq("id", s.ids[2]!);
    // waiting: an order that the test keeps from being sent
    await newOfflineOrder(page, "Status Med One");
    const { data: current } = await freshTenant.client.rpc("order_get", { p_id: s.draftId });
    await freshTenant.client.rpc("order_save", {
      p_id: s.draftId,
      p_request_id: randomUUID(),
      p_expected_version: current.version,
      p_store_id: s.storeId,
      p_notes: "changed on the server",
      p_lines: [{ id: randomUUID(), product_id: s.ids[1]!, name: null, quantity: 8, unit: "box" }],
    });
    let hold = true;
    await context.route(/\/api\/orders\/[0-9a-f-]{36}$/, (route) => {
      if (route.request().method() !== "PUT" || !hold) return route.continue();
      const body = route.request().postDataJSON() as { lines: Array<{ product_id: string | null }> };
      return body.lines.some((l) => l.product_id === s.ids[0]) && body.lines.length === 1 ? route.abort("connectionreset") : route.continue();
    });
    await goOnline(context);

    await page.goto("/settings");
    await expect(page.getByTestId("sync-counts")).toContainText("1 waiting · 0 sending · 1 failed · 1 need a decision", { timeout: 60_000 });
    const items = page.getByTestId("sync-items");
    await expect(items.locator('[data-testid="device-order"][data-state="failed"]')).toContainText(/inactive|no longer/i);
    await expect(items.locator('[data-testid="device-order"][data-state="conflict"]')).toBeVisible();

    // Retry on the failed item sends it once the medicine is active again
    await serviceClient().from("products").update({ is_active: true }).eq("id", s.ids[2]!);
    await items.locator('[data-testid="device-order"][data-state="failed"]').getByTestId("sync-retry").click();
    await expect(page.getByTestId("sync-counts")).toContainText("0 failed", { timeout: 60_000 });

    // opening the conflicting order shows the decision
    await items.locator('[data-testid="device-order"][data-state="conflict"]').getByTestId("order-list-item").click();
    await expect(page.getByTestId("conflict-panel")).toBeVisible({ timeout: 30_000 });
    hold = false;
    expect((await readJournal(page)).length).toBeGreaterThan(0);
  });

  test("pausing keeps every order on the phone and says so; resuming sends it", async ({ page, context, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await newOfflineOrder(page, "Status Med Two");
    await page.goto("/settings");
    await page.getByTestId("pause-sync").click();
    await expect(page.getByTestId("pause-sync")).toContainText("Resume sending");
    await expect(page.getByText("Sending is paused. Every order stays on this phone until you resume.")).toBeVisible();
    await goOnline(context);
    await page.waitForTimeout(4_000);
    expect(await countOrders(freshTenant)).toBe(1); // only the seeded draft: nothing was sent while paused
    await expect(page.getByTestId("sync-counts")).toContainText("1 waiting");
    await page.getByTestId("pause-sync").click();
    await expect.poll(() => countOrders(freshTenant), { timeout: 60_000 }).toBe(2);
  });

  test("refreshing the device copy updates the times, and a copy older than a day says so", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    const old = new Date(Date.now() - 26 * 3_600_000).toISOString();
    await page.evaluate(async (old) => {
      const dbs = (await indexedDB.databases?.()) ?? [];
      const name = dbs.find((d) => d.name?.startsWith("medsupply-") && d.name !== "medsupply-registry")!.name!;
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("meta", "readwrite");
        tx.objectStore("meta").put({ key: "medicinesUpdatedAt", value: old });
        tx.objectStore("meta").put({ key: "storesUpdatedAt", value: old });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, old);
    await page.goto("/settings");
    await expect(page.getByTestId("sync-cache")).toContainText("more than a day ago", { timeout: 15_000 });
    await page.getByTestId("refresh-device-copy").click();
    await expect(page.getByTestId("sync-cache")).not.toContainText("more than a day ago", { timeout: 30_000 });
  });

  test("clear device data warns, deletes only this business's data on the phone, and leaves the server alone", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await page.goto("/settings");
    await page.getByTestId("clear-device-data").click();
    await expect(page.getByTestId("export-offer")).toHaveCount(0); // nothing is waiting, so no backup offer
    await page.getByTestId("clear-device-data-confirm").click();
    await page.waitForLoadState("load");
    await page.goto("/settings");
    await expect(page.getByTestId("sync-empty")).toBeVisible();
    expect(await countOrders(freshTenant)).toBe(1); // the server order is untouched
  });
});
