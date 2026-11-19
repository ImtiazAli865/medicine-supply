import { insertMedicines, seedSimilar } from "../helpers/fast";
import { createOrder, line, seedStore, startOrder, waitSaved } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US4 of Module 008: quantity shortcuts without mistakes (mobile, 360 px).
test.describe("US4: quantity shortcuts", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  async function seed(tenant: import("../helpers/supabase-test").TestTenant) {
    const similar = await seedSimilar(tenant.client);
    const [brufen] = await insertMedicines(tenant.client, [{ name: "Brufen", strength: "400 mg", dosage_form: "tablet", pack_size: "20", manufacturer: "Abbott", selling_price: "20.00" }]);
    const storeId = await seedStore(tenant, "Quantity Store");
    return { similar, brufen: brufen!, storeId };
  }

  test("'pan x20' shows the quantity, adds nothing by itself, and a chosen result is added at once with quantity 20 and an Undo", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Quantity Store");
    const box = page.getByTestId("fast-search");
    const results = page.getByTestId("medicine-result");
    await box.fill("pan x20");
    await expect(page.getByTestId("fast-quantity-tag")).toContainText("Quantity 20");
    await expect(results).toHaveCount(4);
    for (let i = 0; i < 4; i += 1) await expect(results.nth(i)).toHaveAttribute("data-highlighted", "false");
    await box.press("Enter"); // several results: nothing is chosen, the quantity never chooses one
    await expect(page.getByTestId("order-line")).toHaveCount(0);

    await results.filter({ hasText: "syrup" }).first().click();
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await expect(line(page, 0).getByLabel("Quantity")).toHaveValue("20");
    await expect(line(page, 0)).toContainText("syrup");
    await expect(page.getByTestId("undo-bar")).toContainText("Added Panadol");
    await expect(page.getByTestId("fast-chosen")).toHaveCount(0); // no quantity step
    await expect(box).toHaveValue("");
    await expect(box).toBeFocused();
    await page.getByTestId("undo-action").click();
    await expect(page.getByTestId("order-line")).toHaveCount(0);
  });

  test("Enter on a single highlighted result with a quantity adds it at once", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Quantity Store");
    const box = page.getByTestId("fast-search");
    await box.fill("bruf x15");
    await expect(page.getByTestId("medicine-result")).toHaveCount(1);
    await expect(page.getByTestId("medicine-result")).toHaveAttribute("data-highlighted", "true");
    await box.press("Enter");
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await expect(line(page, 0).getByLabel("Quantity")).toHaveValue("15");
    await waitSaved(page);
  });

  test("an invalid 'x' quantity adds nothing, states the allowed range and keeps the typed text", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Quantity Store");
    const box = page.getByTestId("fast-search");
    for (const text of ["bruf x0", "bruf x100001"]) {
      await box.fill(text);
      await expect(page.getByTestId("fast-quantity-tag")).toContainText("whole number from 1 to 100,000");
      await page.getByTestId("medicine-result").first().click();
      await expect(page.getByTestId("fast-hint-error")).toContainText("whole number from 1 to 100,000");
      await expect(box).toHaveValue(text);
      await expect(page.getByTestId("order-line")).toHaveCount(0);
    }
  });

  test("an invalid number in the quantity box adds nothing, states the range and keeps what was typed", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Quantity Store");
    await page.getByTestId("fast-search").fill("bruf");
    await expect(page.getByTestId("medicine-result")).toHaveCount(1);
    await page.getByTestId("fast-search").press("Enter");
    const quantity = page.getByTestId("fast-quantity");
    await expect(quantity).toBeFocused();
    for (const value of ["", "0", "-1", "1.5", "100001", "abc"]) {
      await quantity.fill(value);
      await quantity.press("Enter");
      await expect(page.getByTestId("fast-quantity-error")).toContainText("whole number from 1 to 100,000");
      await expect(quantity).toHaveValue(value);
      await expect(page.getByTestId("order-line")).toHaveCount(0);
    }
    await quantity.fill("7");
    await quantity.press("Enter");
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await expect(line(page, 0).getByLabel("Quantity")).toHaveValue("7");
  });

  test("the quick buttons and the stepper only fill the quantity box, and the cursor stays in it", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Quantity Store");
    await page.getByTestId("fast-search").fill("bruf");
    await expect(page.getByTestId("medicine-result")).toHaveCount(1);
    await page.getByTestId("fast-search").press("Enter");
    const quantity = page.getByTestId("fast-quantity");
    await page.getByTestId("fast-plus").click();
    await page.getByTestId("fast-plus").click();
    await expect(quantity).toHaveValue("3");
    await page.getByTestId("fast-quick").filter({ hasText: "20" }).click();
    await expect(quantity).toHaveValue("20");
    await page.getByTestId("fast-minus").click();
    await expect(quantity).toHaveValue("19");
    await expect(page.getByTestId("order-line")).toHaveCount(0); // nothing is added until Enter or Add
    await expect(quantity).toBeFocused(); // the buttons did not take the focus (the phone keyboard would close)
    await quantity.press("Enter");
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await expect(line(page, 0).getByLabel("Quantity")).toHaveValue("19");
    // the add button and Cancel work too
    await page.getByTestId("fast-search").fill("bruf");
    await expect(page.getByTestId("medicine-result")).toHaveCount(1);
    await page.getByTestId("fast-search").press("Enter");
    await page.getByTestId("fast-cancel").click();
    await expect(page.getByTestId("fast-chosen")).toHaveCount(0);
    await expect(page.getByTestId("order-line")).toHaveCount(1);
  });

  test("an order with 200 lines disables adding and states the limit", async ({ page, freshTenant }) => {
    test.setTimeout(120_000);
    const { brufen, storeId } = await seed(freshTenant);
    await createOrder(freshTenant, storeId, [{ product_id: brufen, quantity: 3, unit: "strip" }], { confirm: true }); // gives a usual card
    const draft = await createOrder(
      freshTenant,
      storeId,
      Array.from({ length: 200 }, (_, i) => ({ product_id: null, name: `Typed line ${i + 1}`, quantity: 1, unit: "strip" })),
    );
    await signIn(page, freshTenant);
    await page.goto(`/orders/${draft.id}`);
    await expect(page.getByTestId("order-line")).toHaveCount(200);
    await expect(page.getByText("An order can have at most 200 lines")).toBeVisible();
    await expect(page.getByTestId("fast-search")).toBeDisabled();
    await expect(page.getByTestId("fast-add")).toBeDisabled();
    await expect(page.getByTestId("usual-add").first()).toBeDisabled();
    await expect(page.getByTestId("repeat-last-order")).toHaveCount(0);
  });
});
