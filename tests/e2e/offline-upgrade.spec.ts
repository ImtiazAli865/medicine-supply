import { insertMedicines } from "../helpers/fast";
import { idbCount, waitDeviceReady } from "../helpers/offline";
import { seedStore } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// T070 of Module 009: what is kept on the phone survives a reload unchanged, and a database written by a NEWER version of the app
// is refused with a plain message and is never changed or deleted (mobile project only, real browser storage).
test.describe("Module 009: the data kept on the phone across app versions", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(120_000);

  test("the lists kept on the phone are still there, unchanged, after the app is opened again", async ({ page, freshTenant }) => {
    await insertMedicines(freshTenant.client, [{ name: "Upgrade Med", strength: "10 mg", selling_price: "10.00" }]);
    await seedStore(freshTenant, "Upgrade Store");
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    const medicines = await idbCount(page, "medicines");
    const stores = await idbCount(page, "stores");
    expect(medicines).toBeGreaterThan(0);
    await page.reload();
    await waitDeviceReady(page);
    expect(await idbCount(page, "medicines")).toBe(medicines);
    expect(await idbCount(page, "stores")).toBe(stores);
  });

  test("a database from a newer version of the app is refused with a plain message and is left untouched", async ({ page, freshTenant }) => {
    await insertMedicines(freshTenant.client, [{ name: "Newer Med", strength: "10 mg", selling_price: "10.00" }]);
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    const before = await idbCount(page, "medicines");
    // pretend a newer app version upgraded this phone's database
    const name = await page.evaluate(async () => {
      const found = (await indexedDB.databases()).find((d) => d.name?.startsWith("medsupply-") && d.name !== "medsupply-registry");
      if (!found?.name) throw new Error("No business database found.");
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(found.name!, 50);
        open.onupgradeneeded = () => undefined;
        open.onsuccess = () => {
          open.result.close();
          resolve();
        };
        open.onerror = () => reject(open.error);
        open.onblocked = () => reject(new Error("blocked"));
      });
      return found.name;
    });
    await page.goto("/settings");
    await expect(page.getByTestId("sync-status")).toContainText("newer version of the app", { timeout: 30_000 });
    // the app keeps working online and the newer database was not changed or deleted
    await expect(page.getByTestId("business-name")).toBeVisible();
    const version = await page.evaluate(async (dbName) => (await indexedDB.databases()).find((d) => d.name === dbName)?.version, name);
    expect(version).toBe(50);
    expect(before).toBeGreaterThan(0);
  });
});
