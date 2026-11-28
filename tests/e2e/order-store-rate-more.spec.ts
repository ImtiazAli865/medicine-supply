import { readFileSync } from "node:fs";
import { insertMedicines } from "../helpers/fast";
import { goOffline, waitDeviceReady } from "../helpers/offline";
import type { TestTenant } from "../helpers/supabase-test";
import { addMedicine, createOrder, line, seedStore, startOrder } from "./orders-helpers";
import { expect, signIn, smallTargets, test } from "./fixtures";

// Module 012: the store's rate through usual medicines, repeat and the last-order checklist, on Pending Prices, in the
// backup file, and the loading error of the store's price list.

async function seed(tenant: TestTenant, price: string | null = "210.00") {
  const [med] = await insertMedicines(tenant.client, [{ name: "More Panadol", strength: "500 mg", selling_price: price ?? "50.00" }]);
  if (price === null) await tenant.client.from("products").update({ selling_price: null }).eq("id", med!);
  const store = await seedStore(tenant, "Aftab Pharmacy");
  return { med: med!, store };
}

async function setRate(tenant: TestTenant, store: string, med: string, rate: string) {
  const { error, data } = await tenant.client.rpc("store_rate_set", { p_store: store, p_product: med, p_rate: rate, p_expected_version: null });
  if (error || !(data as { done: boolean }).done) throw new Error(error?.message ?? JSON.stringify(data));
}

test.describe("Module 012: rates in the shortcuts, Pending Prices, backup and the price list", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(240_000);

  test("usual medicines, repeat last order and the checklist all use the store's rate, never the old order's price", async ({ page, freshTenant }) => {
    const s = await seed(freshTenant);
    await createOrder(freshTenant, s.store, [{ product_id: s.med, quantity: 4, unit: "strip" }], { confirm: true });
    await setRate(freshTenant, s.store, s.med, "225");
    await signIn(page, freshTenant);

    await startOrder(page, "Aftab Pharmacy");
    await page.getByTestId("usual-add").first().click();
    await expect(line(page, 0).getByTestId("line-price")).toContainText("Store rate PKR 225.00");

    await startOrder(page, "Aftab Pharmacy");
    await page.getByTestId("repeat-last-order").click();
    await expect(line(page, 0).getByTestId("line-price")).toContainText("Store rate PKR 225.00");

    await startOrder(page, "Aftab Pharmacy");
    await page.getByTestId("checklist-open").click();
    await page.getByTestId("checklist-toggle").first().click();
    await page.getByTestId("checklist-add").click();
    await expect(line(page, 0).getByTestId("line-price")).toContainText("Store rate PKR 225.00");
  });

  test("Pending Prices shows that a store with its own rate gets that rate", async ({ page, freshTenant }) => {
    const s = await seed(freshTenant, null);
    await createOrder(freshTenant, s.store, [{ product_id: s.med, quantity: 2, unit: "strip" }], { confirm: true });
    await setRate(freshTenant, s.store, s.med, "230");
    await signIn(page, freshTenant);
    await page.goto(`/pending/prices/${s.med}`);
    await page.getByTestId("price-input").fill("215");
    await page.getByTestId("price-review").click();
    await expect(page.getByTestId("review-store-rates")).toContainText("1 line of stores with their own rate");
    await expect(page.getByTestId("fill-line")).toContainText("store rate");
    await page.getByTestId("fill-confirm").click();
    await expect(page.getByTestId("fill-result")).toContainText("their rate");
  });

  test("the price list shows loading, then an error with Retry when it cannot load", async ({ page, freshTenant }) => {
    const s = await seed(freshTenant);
    await signIn(page, freshTenant);
    let fail = true;
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\/api\/stores\/[0-9a-f-]{36}\/rates$/, async (route) => {
      if (!fail) return route.continue();
      await held;
      await route.fulfill({ status: 500, json: { code: "server_error", message: "Something went wrong." } });
    });
    await page.goto(`/stores/${s.store}`);
    await expect(page.getByTestId("store-rates").getByTestId("loading")).toBeVisible();
    release();
    await expect(page.getByTestId("store-rates").getByTestId("error-state")).toBeVisible();
    fail = false;
    await page.getByTestId("store-rates").getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("store-rates").getByTestId("empty-state")).toContainText("No special prices yet");
    expect(await smallTargets(page)).toEqual([]);
  });

  test("a backup made without the internet keeps the typed price and no other price; the controls fit 360 px", async ({ page, context, freshTenant }) => {
    const s = await seed(freshTenant);
    await setRate(freshTenant, s.store, s.med, "225");
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);

    await page.goto("/orders/new");
    await page.getByTestId("store-option").filter({ hasText: "Aftab Pharmacy" }).first().click();
    await page.getByTestId("fast-search").fill("more panadol");
    await expect(page.getByTestId("result-store-rate")).toHaveText("Store rate PKR 225.00");
    await page.getByTestId("medicine-result").first().click();
    await page.getByTestId("fast-quantity").press("Enter");
    await line(page, 0).getByTestId("change-price").click();
    expect(await smallTargets(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await line(page, 0).getByLabel("Price (PKR)").fill("235");
    await line(page, 0).getByTestId("price-use").click();
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "on_device");

    await page.goto("/settings");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("backup-export").click()]);
    const path = test.info().outputPath(download.suggestedFilename());
    await download.saveAs(path);
    const file = JSON.parse(readFileSync(path, "utf8")) as { version: number; waiting: { orders: Array<{ lines: Array<Record<string, unknown>> }> } };
    expect(file.version).toBe(3);
    expect(file.waiting.orders[0]!.lines[0]).toMatchObject({ price: "235.00" });
    expect(JSON.stringify(file)).not.toMatch(/225\.00|210\.00|selling_price|purchase/);
  });

  test("a rate changed elsewhere is not replaced, and the screen says so; remember is off until ticked", async ({ page, freshTenant }) => {
    const s = await seed(freshTenant);
    await setRate(freshTenant, s.store, s.med, "220");
    await signIn(page, freshTenant);
    await startOrder(page, "Aftab Pharmacy");
    await addMedicine(page, "more panadol", "More Panadol");
    await expect(line(page, 0).getByTestId("line-price")).toContainText("Store rate PKR 220.00");
    const changed = await freshTenant.client.rpc("store_rate_set", { p_store: s.store, p_product: s.med, p_rate: "230", p_expected_version: 1 });
    expect(changed.error).toBeNull();
    await line(page, 0).getByTestId("change-price").click();
    await line(page, 0).getByLabel("Price (PKR)").fill("240");
    await line(page, 0).getByTestId("price-use").click();
    await expect(line(page, 0).getByTestId("remember-rate")).not.toBeChecked();
    await line(page, 0).getByTestId("remember-rate").check();
    await expect(page.getByTestId("rate-conflict")).toContainText("not replaced", { timeout: 30_000 });
    const { data } = await freshTenant.client.rpc("store_rates_list", { p_store: s.store });
    expect((data as Array<{ rate: string }>).map((r) => r.rate)).toEqual(["230.00"]);
  });
});
