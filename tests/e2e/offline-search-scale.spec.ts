import { insertMedicines, seedCatalog } from "../helpers/fast";
import { goOffline, waitDeviceReady } from "../helpers/offline";
import { seedStore } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// SC-008 of Module 009: searching the copy of a 5,000-medicine catalog on the phone, with no internet, answers within 300 ms.
test.describe("US1: offline search of a large catalog", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(240_000);

  test("results for a few letters appear within 300 ms (median of 5 searches) with every identifying detail, and the Module 008 rules still hold", async ({ page, context, freshTenant }) => {
    await seedCatalog(freshTenant.client, 5_000);
    await insertMedicines(freshTenant.client, [
      { name: "Panadol", strength: "250 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK" },
      { name: "Panadol", strength: "500 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK" },
      { name: "Panadol", strength: "500 mg", dosage_form: "syrup", pack_size: "60 ml", manufacturer: "GSK" },
    ]);
    await seedStore(freshTenant, "Scale Store");
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    // the whole catalog is on the phone
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const dbs = (await indexedDB.databases?.()) ?? [];
            const name = dbs.find((d) => d.name?.startsWith("medsupply-") && d.name !== "medsupply-registry")?.name;
            if (!name) return 0;
            const db: IDBDatabase = await new Promise((resolve, reject) => {
              const req = indexedDB.open(name);
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
            try {
              return await new Promise<number>((resolve) => {
                const req = db.transaction("medicines", "readonly").objectStore("medicines").count();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(0);
              });
            } finally {
              db.close();
            }
          }),
        { timeout: 90_000 },
      )
      .toBeGreaterThanOrEqual(5_003);

    await goOffline(context);
    await page.goto("/orders/new");
    await page.getByTestId("store-option").filter({ hasText: "Scale Store" }).first().click();
    const box = page.getByTestId("fast-search");
    await expect(box).toBeVisible();
    // let the whole list load from the phone before timing
    await expect(page.getByTestId("fast-search")).toBeEnabled();
    await page.waitForTimeout(3_000);

    const times: number[] = [];
    for (const text of ["pan", "pana", "panad", "medicine 04", "medicine 0123"]) {
      await box.fill("");
      const started = Date.now();
      await box.fill(text);
      await expect(page.getByTestId("medicine-result").first()).toBeVisible();
      times.push(Date.now() - started);
    }
    times.sort((a, b) => a - b);
    console.log("OFFLINE-SEARCH-MS", JSON.stringify(times));
    expect(times[2]!).toBeLessThanOrEqual(300);

    // the Module 008 rules hold offline: nothing is preselected when several fit, every result names its details
    await box.fill("panadol");
    const results = page.getByTestId("medicine-result");
    await expect(results).toHaveCount(3);
    await expect(results.filter({ hasText: "syrup" })).toHaveCount(1);
    await expect(results.filter({ hasText: "tablet" })).toHaveCount(2);
    await expect(results.filter({ hasText: "250 mg" })).toHaveCount(1);
    for (const result of await results.all()) {
      await expect(result).toContainText("GSK"); // every result names its manufacturer, strength, form and pack size
      await expect(result).toContainText(/mg/);
    }
    await box.fill("panadol 250");
    await expect(results).toHaveCount(1);
  });
});
