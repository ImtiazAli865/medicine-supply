import { randomUUID } from "node:crypto";
import { blockDeviceStorage, goOffline, waitDeviceReady } from "../helpers/offline";
import { serviceClient, type TestTenant } from "../helpers/supabase-test";
import { expect, signIn, test } from "./fixtures";

// Module 011, US1: the Record payment screen always has a loading, an empty and an error state, and the account actions that
// need the internet stay blocked offline (mobile, 360 px).
test.describe("US1: states of the Record payment screen", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(150_000);

  async function seedStore(tenant: TestTenant, name: string): Promise<string> {
    const id = randomUUID();
    const { error } = await serviceClient().from("stores").insert({ id, business_id: tenant.businessId, name });
    if (error) throw new Error(error.message);
    return id;
  }

  test("shows a loading state while the stores are read, then the form", async ({ page, context, freshTenant }) => {
    await seedStore(freshTenant, "Slow Store");
    // While the flag is set, every page of this tab holds a write transaction open on the stores of this phone, so the read of the
    // screen has to wait (a real delay of the real storage, not a faked answer). The flag lives in sessionStorage, so it survives
    // the full page load that the offline shell does when a link is followed.
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__holdStores") !== "1") return;
      void (async () => {
        const dbs = (await indexedDB.databases?.()) ?? [];
        const name = dbs.find((d) => d.name?.startsWith("medsupply-") && d.name !== "medsupply-registry")?.name;
        if (!name) return;
        const req = indexedDB.open(name);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("stores", "readwrite");
          const store = tx.objectStore("stores");
          const keep = () => {
            if (sessionStorage.getItem("__holdStores") !== "1") return;
            store.get("nothing-here").onsuccess = keep;
          };
          keep();
          tx.oncomplete = () => db.close();
        };
      })();
    });
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await page.evaluate(() => sessionStorage.setItem("__holdStores", "1"));
    await page.goto("/offline");
    await page.getByTestId("offline-record-payment").click();
    await expect(page.getByTestId("loading")).toBeVisible();
    await expect(page.getByTestId("payment-store")).toHaveCount(0);
    await page.evaluate(() => sessionStorage.setItem("__holdStores", "0"));
    await expect(page.getByTestId("payment-store")).toBeVisible();
    await expect(page.getByTestId("payment-store").locator("option")).toHaveText(["Choose a store", "Slow Store"]);
  });

  test("shows an empty state with a next action when the phone has no stores", async ({ page, context, freshTenant }) => {
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await page.goto("/offline");
    await page.getByTestId("offline-record-payment").click();
    const empty = page.getByTestId("empty-state");
    await expect(empty).toContainText("No stores on this phone yet");
    await expect(empty).toContainText("Open the app once online, or take an order for a new store first.");
    await empty.getByRole("link", { name: "Take an order for a new store" }).click();
    await expect(page.getByTestId("add-new-store")).toBeVisible();
  });

  test("shows an error with Retry when the stores of the phone cannot be read, and recovers", async ({ page, context, freshTenant }) => {
    await seedStore(freshTenant, "Readable Store");
    await page.addInitScript(() => {
      const original = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.getAll = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["getAll"]>) {
        if (this.name === "stores" && sessionStorage.getItem("__failStores") === "1") throw new DOMException("The read failed.", "UnknownError");
        return original.apply(this, args);
      };
    });
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await page.goto("/offline");
    await page.evaluate(() => sessionStorage.setItem("__failStores", "1"));
    await page.getByTestId("offline-record-payment").click();
    const error = page.getByTestId("error-state");
    await expect(error).toContainText("The stores on this phone could not be read.");
    await page.evaluate(() => sessionStorage.setItem("__failStores", "0"));
    await error.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("payment-store").locator("option")).toHaveText(["Choose a store", "Readable Store"]);
  });

  test("says so plainly when this browser cannot keep data on the phone", async ({ page, freshTenant }) => {
    await blockDeviceStorage(page);
    await signIn(page, freshTenant);
    await page.goto("/offline?go=%2Faccounts%2Fpay");
    await expect(page.getByTestId("offline-unavailable")).toBeVisible();
    await expect(page.getByTestId("payment-amount")).toHaveCount(0);
  });

  test("the account actions that need the internet stay blocked offline: no payment form there", async ({ page, context, freshTenant }) => {
    const storeId = await seedStore(freshTenant, "Blocked Store");
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    for (const path of [`/accounts/${storeId}`, `/accounts/${storeId}/statement`, "/accounts", "/invoices", "/reports"]) {
      await page.goto(path);
      await expect(page.getByTestId("offline-blocked"), path).toBeVisible();
      await expect(page.getByTestId("payment-amount"), path).toHaveCount(0);
    }
    await page.goto(`/offline?go=${encodeURIComponent(`/accounts/${storeId}`)}`);
    await expect(page.getByTestId("offline-blocked")).toContainText("Store accounts needs the internet");
    await expect(page.getByTestId("payment-amount")).toHaveCount(0);
  });
});
