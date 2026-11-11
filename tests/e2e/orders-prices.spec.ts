import { addMedicine, createOrder, line, seedMedicines, seedStore, startOrder, waitSaved } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US4: prices stay as they were; unpriced medicines are shown clearly and never block.
test.describe("US4: price snapshots and unpriced lines", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("a draft shows the current price and the line total; an unpriced medicine shows 'No selling price' and no total", async ({ page, freshTenant }) => {
    await seedMedicines(freshTenant);
    await seedStore(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Al Shifa Pharmacy");
    await addMedicine(page, "panadol");
    await addMedicine(page, "calpol");
    await waitSaved(page);

    await expect(line(page, 0).getByTestId("line-price")).toContainText("Current price PKR 125.50");
    await expect(line(page, 0).getByTestId("line-total")).toHaveText("PKR 125.50");
    await line(page, 0).getByLabel("Quantity").fill("3");
    await expect(line(page, 0).getByTestId("line-total")).toHaveText("PKR 376.50");
    await expect(line(page, 1)).toContainText("No selling price");
    await expect(line(page, 1).getByTestId("line-price")).toHaveCount(0);

    // the total says it counts priced lines only, and how many lines are unpriced
    await expect(page.getByTestId("order-totals")).toContainText("Total of priced lines");
    await expect(page.getByTestId("order-total-amount")).toHaveText("PKR 376.50");
    await expect(page.getByTestId("order-total-note")).toHaveText("1 line has no selling price");
  });

  test("a confirmed order keeps the old price and total after the catalog price changes", async ({ page, freshTenant }) => {
    const catalog = await seedMedicines(freshTenant);
    const store = await seedStore(freshTenant);
    const order = await createOrder(freshTenant, store, [{ product_id: catalog.pricedId, quantity: 3, unit: "strip" }], { confirm: true });
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    await expect(page.getByTestId("line-total")).toHaveText("PKR 376.50");

    const changed = await freshTenant.client.from("products").update({ selling_price: "999.00" }).eq("id", catalog.pricedId);
    expect(changed.error).toBeNull();
    await page.reload();
    await expect(page.getByTestId("line-price")).toContainText("PKR 125.50");
    await expect(page.getByTestId("line-price")).not.toContainText("Current price");
    await expect(page.getByTestId("line-total")).toHaveText("PKR 376.50");
    await expect(page.getByTestId("order-total-amount")).toHaveText("PKR 376.50");

    // a draft, by contrast, follows the catalog until it is confirmed
    const draft = await createOrder(freshTenant, store, [{ product_id: catalog.pricedId, quantity: 1, unit: "strip" }]);
    await page.goto(`/orders/${draft.id}`);
    await expect(page.getByTestId("line-price")).toContainText("Current price PKR 999.00");
  });

  test("an order with unpriced medicines confirms without any block, and shows no price for them", async ({ page, freshTenant }) => {
    await seedMedicines(freshTenant);
    await seedStore(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Al Shifa Pharmacy");
    await addMedicine(page, "calpol");
    await waitSaved(page);
    await page.getByTestId("confirm-order").click();
    await expect(page.getByRole("dialog")).toContainText("no selling price");
    await page.getByTestId("confirm-order-yes").click();
    await expect(page.getByTestId("order-status")).toContainText("Confirmed", { timeout: 15_000 });
    await expect(page.getByTestId("order-line").getByText("No selling price")).toBeVisible();
    await expect(page.getByTestId("line-price")).toHaveCount(0);
    await expect(page.getByTestId("order-total-amount")).toHaveText("—");
  });

  test("no purchase price, MRP, margin or profit appears on any order screen", async ({ page, freshTenant }) => {
    const catalog = await seedMedicines(freshTenant);
    const store = await seedStore(freshTenant);
    const draft = await createOrder(freshTenant, store, [{ product_id: catalog.pricedId, quantity: 2, unit: "strip" }]);
    const confirmed = await createOrder(freshTenant, store, [{ product_id: catalog.pricedId, quantity: 2, unit: "strip" }], { confirm: true });
    await signIn(page, freshTenant);
    for (const path of [`/orders/${draft.id}`, `/orders/${confirmed.id}`, "/orders", "/"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const text = await page.locator("body").innerText();
      expect(text, path).not.toMatch(/purchase|MRP|margin|profit|cost/i);
      expect(text, path).not.toMatch(/\b90\.00\b|\b130\.00\b/);
    }
  });

  test("the confirm step says prices are recorded as of now", async ({ page, freshTenant }) => {
    await seedMedicines(freshTenant);
    await seedStore(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Al Shifa Pharmacy");
    await addMedicine(page, "panadol");
    await waitSaved(page);
    await page.getByTestId("confirm-order").click();
    await expect(page.getByRole("dialog")).toContainText("Prices are recorded as of now");
    await page.getByTestId("confirm-order-yes").click();
    await expect(page.getByTestId("order-status")).toContainText("Confirmed", { timeout: 15_000 });
  });
});
