import type { Page } from "@playwright/test";
import { insertMedicines } from "../helpers/fast";
import { blockDeviceStorage, goOffline, waitDeviceReady } from "../helpers/offline";
import type { TestTenant } from "../helpers/supabase-test";
import { createOrder, seedStore } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US1 of Module 009: the app is honest about what it can and cannot do offline (mobile, 360 px).
test.describe("US1: honest states", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  async function seed(tenant: TestTenant) {
    const [m1] = await insertMedicines(tenant.client, [{ name: "Honest Med", strength: "5 mg", selling_price: "10.00" }]);
    const storeId = await seedStore(tenant, "Honest Store");
    const confirmed = await createOrder(tenant, storeId, [{ product_id: m1!, quantity: 2, unit: "strip" }], { confirm: true });
    return { storeId, confirmedId: confirmed.id };
  }

  /** Runs in the page: edits the device database of the signed-in business. */
  async function editMeta(page: Page, key: string, value: string | null) {
    await page.evaluate(
      async ({ key, value }) => {
        const dbs = (await indexedDB.databases?.()) ?? [];
        const name = dbs.find((d) => d.name?.startsWith("medsupply-") && d.name !== "medsupply-registry")?.name;
        if (!name) throw new Error("no device database");
        const db: IDBDatabase = await new Promise((resolve, reject) => {
          const req = indexedDB.open(name);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("meta", "readwrite");
          if (value === null) tx.objectStore("meta").delete(key);
          else tx.objectStore("meta").put({ key, value });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      },
      { key, value },
    );
  }

  test("when the phone cannot keep data, the app says so, keeps the screen, and never claims 'Saved on this device'", async ({ page, context, freshTenant }) => {
    await seed(freshTenant);
    await blockDeviceStorage(page);
    await signIn(page, freshTenant);
    // online, the app works exactly as before: the server confirms the save
    await page.goto("/orders/new");
    await page.getByTestId("store-option").filter({ hasText: "Honest Store" }).first().click();
    await page.getByTestId("fast-search").fill("Honest Med");
    await page.getByTestId("medicine-result").first().click();
    await page.getByTestId("fast-quantity").press("Enter");
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved", { timeout: 15_000 });
    await expect(page.getByTestId("save-status")).not.toContainText("on this device");

    // offline: the page request is answered by the offline shell, which says offline orders cannot be kept here
    await goOffline(context);
    await page.goto("/orders");
    await expect(page.getByTestId("offline-unavailable")).toContainText("Offline orders cannot be kept here");
    await expect(page.getByText("Saved on this device")).toHaveCount(0);
  });

  test("with no lists saved yet the screen explains it and names the next step", async ({ page, context, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    // the lists have never been loaded: forget the times of the last refresh and the saved lists
    await editMeta(page, "medicinesUpdatedAt", null);
    await editMeta(page, "storesUpdatedAt", null);
    await goOffline(context);
    await page.goto("/orders/new");
    await expect(page.getByTestId("device-note")).toContainText("not loaded yet");
    await expect(page.getByTestId("device-note")).toContainText("Connect once");
  });

  test("the time of the last refresh is shown offline, and a note says when the lists are older than a day", async ({ page, context, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    const old = new Date(Date.now() - 26 * 3_600_000).toISOString();
    await editMeta(page, "medicinesUpdatedAt", old);
    await editMeta(page, "storesUpdatedAt", old);
    await goOffline(context);
    await page.goto("/orders/new");
    await expect(page.getByTestId("device-note")).toContainText("more than a day ago");
  });

  test("what needs the internet says so and does nothing: a confirmed order, invoices, and Register or Link of a typed line", async ({ page, context, freshTenant }) => {
    const { storeId, confirmedId } = await seed(freshTenant);
    await signIn(page, freshTenant);
    await waitDeviceReady(page, { storeExtras: [storeId] });
    await goOffline(context);

    await page.goto(`/orders/${confirmedId}`);
    await expect(page.getByTestId("offline-blocked")).toContainText("needs the internet");
    await expect(page.getByTestId("edit-order")).toHaveCount(0);
    await expect(page.getByTestId("cancel-order")).toHaveCount(0);

    await page.goto("/invoices");
    await expect(page.getByTestId("offline-blocked")).toContainText("Invoices");
    await page.goto("/accounts");
    await expect(page.getByTestId("offline-blocked")).toContainText("Store accounts");

    // a typed medicine can be added offline, but Register and Link need the internet
    await page.goto("/orders/new");
    await page.getByTestId("store-option").filter({ hasText: "Honest Store" }).first().click();
    await page.getByTestId("fast-search").fill("zzz not in the catalog");
    await page.getByTestId("add-as-typed").click();
    const form = page.getByTestId("typed-form");
    await form.getByLabel("Quantity").fill("2");
    await form.getByLabel("Unit").fill("strip");
    await form.getByTestId("add-typed-line").click();
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await expect(page.getByTestId("register-needs-internet")).toContainText("need the internet");
    await expect(page.getByTestId("confirm-order")).toBeDisabled();
    await expect(page.getByTestId("confirm-needs-internet")).toContainText("Confirming needs the internet");
  });

  test("a nearly full phone storage gives a warning and the refresh is skipped with the reason", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "storage", { configurable: true, value: { estimate: async () => ({ usage: 95, quota: 100 }) } });
    });
    await signIn(page, freshTenant);
    await expect(page.getByTestId("sync-indicator")).toBeVisible();
    await page.goto("/orders/new");
    await expect(page.getByTestId("device-copy-warning")).toContainText("storage is nearly full");
  });
});
