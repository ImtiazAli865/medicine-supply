import type { Page } from "@playwright/test";
import { insertMedicines } from "../helpers/fast";
import { goOffline, goOnline, readJournal, waitDeviceReady } from "../helpers/offline";
import type { TestTenant } from "../helpers/supabase-test";
import { addMedicine, confirmOrder, createOrder, line, seedStore, startOrder, waitSaved } from "./orders-helpers";
import { expect, signIn, smallTargets, test } from "./fixtures";

// Module 012: store-specific selling prices on the order screen, the store's price list and offline orders.

async function seed(tenant: TestTenant) {
  const [panadol] = await insertMedicines(tenant.client, [{ name: "Rate Panadol", strength: "500 mg", selling_price: "210.00" }]);
  const aftab = await seedStore(tenant, "Aftab Pharmacy");
  const rozi = await seedStore(tenant, "Rozi Medical");
  const naya = await seedStore(tenant, "Naya Store");
  return { panadol: panadol!, aftab, rozi, naya };
}

async function setPrice(page: Page, index: number, price: string, remember = false) {
  await line(page, index).getByTestId("change-price").click();
  await line(page, index).getByLabel("Price (PKR)").fill(price);
  await line(page, index).getByTestId("price-use").click();
  if (remember) await line(page, index).getByTestId("remember-rate").check();
}

async function rates(tenant: TestTenant, storeId: string) {
  const { data, error } = await tenant.client.rpc("store_rates_list", { p_store: storeId });
  if (error) throw new Error(error.message);
  return (data as Array<{ rate: string; version: number }>).map((r) => r.rate);
}

test.describe("Module 012: a price per store", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(180_000);

  test("three stores are billed their own prices, the next order is filled in, and the catalog stays", async ({ page, freshTenant }) => {
    const s = await seed(freshTenant);
    await signIn(page, freshTenant);

    await startOrder(page, "Aftab Pharmacy");
    await addMedicine(page, "rate panadol", "Rate Panadol", "2");
    await expect(line(page, 0).getByTestId("line-price")).toContainText("Current price PKR 210.00");
    await setPrice(page, 0, "220", true);
    await expect(line(page, 0).getByTestId("line-price")).toContainText("Typed price PKR 220.00");
    await expect(line(page, 0).getByTestId("line-total")).toHaveText("PKR 440.00");
    await waitSaved(page);
    await page.reload();
    await expect(line(page, 0).getByTestId("line-price")).toContainText("PKR 220.00");
    await confirmOrder(page);
    await expect(page.getByTestId("line-price")).toContainText("Price PKR 220.00");
    expect(await rates(freshTenant, s.aftab)).toEqual(["220.00"]);
    expect(await rates(freshTenant, s.rozi)).toEqual([]);

    await startOrder(page, "Aftab Pharmacy");
    await page.getByTestId("fast-search").fill("rate panadol");
    await expect(page.getByTestId("result-store-rate")).toHaveText("Store rate PKR 220.00");
    await addMedicine(page, "rate panadol", "Rate Panadol");
    await expect(line(page, 0).getByTestId("line-price")).toContainText("Store rate PKR 220.00");

    await startOrder(page, "Rozi Medical");
    await addMedicine(page, "rate panadol", "Rate Panadol");
    await expect(line(page, 0).getByTestId("line-price")).toContainText("Current price PKR 210.00");
    const { data } = await freshTenant.client.from("products").select("selling_price").eq("id", s.panadol).single();
    expect(Number(data!.selling_price)).toBe(210);
  });

  test("a catalog change is said, the saved rate stays until it is changed, and the price list shows and removes rates", async ({ page, freshTenant }) => {
    const s = await seed(freshTenant);
    const set = await freshTenant.client.rpc("store_rate_set", { p_store: s.aftab, p_product: s.panadol, p_rate: "200", p_expected_version: null });
    expect(set.error).toBeNull();
    await freshTenant.client.from("products").update({ selling_price: "230.00" }).eq("id", s.panadol);
    await signIn(page, freshTenant);

    await startOrder(page, "Aftab Pharmacy");
    await addMedicine(page, "rate panadol", "Rate Panadol");
    await expect(line(page, 0).getByTestId("line-price")).toContainText("Store rate PKR 200.00");
    await expect(line(page, 0).getByTestId("rate-moved")).toContainText("PKR 210.00");
    await expect(line(page, 0).getByTestId("rate-moved")).toContainText("PKR 230.00");

    await page.goto(`/stores/${s.aftab}`);
    await expect(page.getByTestId("store-rate-value")).toHaveText("PKR 200.00");
    await expect(page.getByTestId("store-rate-moved")).toBeVisible();
    expect(await smallTargets(page)).toEqual([]);
    await page.getByTestId("store-rate-change").click();
    await page.getByLabel("Price (PKR)").fill("0");
    await page.getByTestId("store-rate-save").click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("above 0");
    await page.getByLabel("Price (PKR)").fill("225");
    await page.getByTestId("store-rate-save").click();
    await expect(page.getByTestId("store-rate-value")).toHaveText("PKR 225.00");
    await page.getByTestId("store-rate-remove").click();
    await page.getByTestId("store-rate-remove-yes").click();
    await expect(page.getByTestId("empty-state")).toContainText("No special prices yet");
  });

  test("a far price is asked about, a unit change removes the typed price, and confirming shows a price that moved", async ({ page, freshTenant }) => {
    const s = await seed(freshTenant);
    const draft = await createOrder(freshTenant, s.naya, [{ product_id: s.panadol, quantity: 1, unit: "strip" }]);
    await signIn(page, freshTenant);
    await page.goto(`/orders/${draft.id}`);

    await line(page, 0).getByTestId("change-price").click();
    await line(page, 0).getByLabel("Price (PKR)").fill("21");
    await line(page, 0).getByTestId("price-use").click();
    await expect(line(page, 0).getByTestId("price-far")).toContainText("far from the catalog price");
    await line(page, 0).getByRole("button", { name: "No, change it" }).click();
    await line(page, 0).getByLabel("Price (PKR)").fill("1.234");
    await line(page, 0).getByTestId("price-use").click();
    await expect(line(page, 0).getByRole("alert")).toContainText("at most two decimals");
    await line(page, 0).getByLabel("Price (PKR)").fill("215");
    await line(page, 0).getByTestId("price-use").click();
    await expect(line(page, 0).getByTestId("line-price")).toContainText("PKR 215.00");
    expect(await smallTargets(page)).toEqual([]);

    await line(page, 0).getByLabel("Unit").fill("box");
    await expect(line(page, 0).getByTestId("price-cleared")).toBeVisible();
    await expect(line(page, 0).getByTestId("line-price")).toContainText("PKR 210.00");
    await line(page, 0).getByLabel("Unit").fill("strip");
    await waitSaved(page);

    await page.getByTestId("confirm-order").click();
    await freshTenant.client.from("products").update({ selling_price: "240.00" }).eq("id", s.panadol);
    await page.getByTestId("confirm-order-yes").click();
    await expect(page.getByRole("dialog")).toContainText("A price changed");
    await expect(line(page, 0).getByTestId("line-price")).toContainText("PKR 240.00");
    await page.getByTestId("confirm-order-yes").click();
    await expect(page.getByTestId("order-status")).toContainText("Confirmed", { timeout: 15_000 });
    await expect(page.getByTestId("line-price")).toContainText("PKR 240.00");
  });

  test("without the internet the store's rate is used, a typed price is kept and remembered once it is sent", async ({ page, context, freshTenant }) => {
    const s = await seed(freshTenant);
    await createOrder(freshTenant, s.aftab, [{ product_id: s.panadol, quantity: 1, unit: "strip" }], { confirm: true });
    const set = await freshTenant.client.rpc("store_rate_set", { p_store: s.aftab, p_product: s.panadol, p_rate: "220", p_expected_version: null });
    expect(set.error).toBeNull();
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);

    // Offline, the order opens in the offline app, so the address differs: pick the store and go on.
    await page.goto("/orders/new");
    await page.getByTestId("store-option").filter({ hasText: "Aftab Pharmacy" }).first().click();
    await addMedicine(page, "rate panadol", "Rate Panadol");
    await expect(line(page, 0).getByTestId("line-price")).toContainText("Store rate PKR 220.00");
    await setPrice(page, 0, "225", true);
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "on_device");
    const draftId = (await readJournal(page))[0]!.orderId as string;
    await page.reload();
    await expect(line(page, 0).getByTestId("line-price")).toContainText("Typed price PKR 225.00");
    await expect(line(page, 0).getByTestId("remember-rate")).toBeChecked();

    await goOnline(context);
    await expect.poll(() => rates(freshTenant, s.aftab), { timeout: 60_000 }).toEqual(["225.00"]);
    const { data } = await freshTenant.client.rpc("order_get", { p_id: draftId });
    expect((data as { lines: Array<{ selling_price: string }> }).lines.map((l) => l.selling_price)).toEqual(["225.00"]);
  });
});
