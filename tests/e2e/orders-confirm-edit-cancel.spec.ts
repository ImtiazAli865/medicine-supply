import { createOrder, line, seedMedicines, seedStore } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US6: editing a confirmed order in place, its change history, and cancelling.
test.describe("US6: edit or cancel a confirmed order", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("edit a quantity, add a medicine and remove a line; save once; the history lists each change; old prices stay", async ({ page, freshTenant }) => {
    const catalog = await seedMedicines(freshTenant);
    const store = await seedStore(freshTenant);
    const order = await createOrder(
      freshTenant,
      store,
      [
        { product_id: catalog.pricedId, quantity: 3, unit: "strip" },
        { product_id: null, name: "Typed Item", quantity: 1, unit: "box" },
      ],
      { confirm: true },
    );
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    await expect(page.getByTestId("order-history-log")).toContainText("Order confirmed");
    await page.getByTestId("edit-order").click();
    await expect(page.getByText("You are editing a confirmed order.")).toBeVisible();
    await expect(page.getByTestId("save-status")).toContainText("No unsaved changes");

    // a catalog price change meanwhile must not touch the recorded price
    await freshTenant.client.from("products").update({ selling_price: "999.00" }).eq("id", catalog.pricedId);

    await line(page, 0).getByLabel("Quantity").fill("4");
    await expect(page.getByTestId("save-status")).toContainText("You have unsaved changes");
    await page.getByTestId("add-medicine").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Search medicines").fill("brufen");
    await dialog.getByTestId("medicine-result").first().click();
    await expect(page.getByText("Price recorded when you save")).toBeVisible();
    await page.getByRole("button", { name: "Remove Typed Item" }).click();
    await page.getByTestId("remove-line-yes").click();

    // nothing was saved by typing
    const unsaved = await freshTenant.client.rpc("order_get", { p_id: order.id });
    expect(unsaved.data.version).toBe(order.version);
    expect(unsaved.data.lines).toHaveLength(2);

    await page.getByTestId("save-changes").click();
    await expect(page.getByTestId("order-status")).toContainText("Confirmed");
    await expect(page.getByTestId("edit-order")).toBeVisible();
    await expect(page.getByTestId("order-lines")).toContainText("4 strip");
    await expect(page.getByTestId("order-lines")).toContainText("Brufen 400mg");
    await expect(page.getByTestId("order-lines")).not.toContainText("Typed Item");
    await expect(page.getByTestId("line-price").first()).toContainText("PKR 125.50"); // the recorded price, not 999.00
    await expect(page.getByTestId("line-total").first()).toHaveText("PKR 502.00");

    const events = page.getByTestId("history-event");
    await expect(events).toHaveCount(3); // created, confirmed, edited
    await expect(events.first()).toContainText("Order edited");
    await expect(events.first()).toContainText("Panadol 500mg: quantity 3 → 4");
    await expect(events.first()).toContainText("Added Brufen 400mg");
    await expect(events.first()).toContainText("Removed Typed Item");
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/purchase|MRP/i);
  });

  test("Discard changes puts the saved order back and saves nothing", async ({ page, freshTenant }) => {
    const catalog = await seedMedicines(freshTenant);
    const store = await seedStore(freshTenant);
    const order = await createOrder(freshTenant, store, [{ product_id: catalog.pricedId, quantity: 3, unit: "strip" }], { confirm: true });
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    await page.getByTestId("edit-order").click();
    await line(page, 0).getByLabel("Quantity").fill("50");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByTestId("discard-changes").click();
    await expect(page.getByTestId("edit-order")).toBeVisible();
    await expect(page.getByTestId("order-lines")).toContainText("3 strip");
    const stored = await freshTenant.client.rpc("order_get", { p_id: order.id });
    expect(stored.data.version).toBe(order.version);
  });

  test("cancelling a confirmed order needs a reason; the order becomes read-only with its lines kept", async ({ page, freshTenant }) => {
    const catalog = await seedMedicines(freshTenant);
    const store = await seedStore(freshTenant);
    const order = await createOrder(freshTenant, store, [{ product_id: catalog.pricedId, quantity: 3, unit: "strip" }], { confirm: true });
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    await page.getByTestId("cancel-order").click();
    await expect(page.getByRole("dialog")).toContainText("Cancel this order?");
    await page.getByTestId("cancel-order-yes").click();
    await expect(page.getByText("Enter a reason for cancelling a confirmed order.")).toBeVisible();
    await expect(page.getByTestId("order-status")).toContainText("Confirmed");

    await page.getByLabel(/Reason/).fill("Pharmacy cancelled by phone");
    await page.getByTestId("cancel-order-yes").click();
    await expect(page.getByTestId("order-status")).toContainText("Cancelled");
    await expect(page.getByTestId("cancel-reason")).toContainText("Pharmacy cancelled by phone");
    await expect(page.getByTestId("edit-order")).toHaveCount(0);
    await expect(page.getByTestId("cancel-order")).toHaveCount(0);
    await expect(page.getByTestId("order-lines")).toContainText("3 strip");
    await expect(page.getByTestId("history-event").first()).toContainText("Order cancelled");

    await page.reload(); // still read-only after a reload
    await expect(page.getByTestId("order-status")).toContainText("Cancelled");
    await expect(page.getByTestId("edit-order")).toHaveCount(0);
  });

  test("two pages editing the same confirmed order: the second save is told it changed elsewhere", async ({ page, context, freshTenant }) => {
    const catalog = await seedMedicines(freshTenant);
    const store = await seedStore(freshTenant);
    const order = await createOrder(freshTenant, store, [{ product_id: catalog.pricedId, quantity: 3, unit: "strip" }], { confirm: true });
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    await page.getByTestId("edit-order").click();

    const other = await context.newPage();
    await other.goto(`/orders/${order.id}`);
    await other.getByTestId("edit-order").click();
    await line(other, 0).getByLabel("Quantity").fill("5");
    await other.getByTestId("save-changes").click();
    await expect(other.getByTestId("edit-order")).toBeVisible();

    await line(page, 0).getByLabel("Quantity").fill("8");
    await page.getByTestId("save-changes").click();
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "changed_elsewhere", { timeout: 15_000 });
    const stored = await freshTenant.client.rpc("order_get", { p_id: order.id });
    expect(stored.data.lines[0].quantity).toBe(5); // nothing was overwritten
  });

  test("a confirmed order cannot be saved with no lines and a typed line's recorded name is not editable", async ({ page, freshTenant }) => {
    const store = await seedStore(freshTenant);
    const order = await createOrder(freshTenant, store, [{ product_id: null, name: "Typed Item", quantity: 1, unit: "box" }], { confirm: true });
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    await page.getByTestId("edit-order").click();
    await expect(line(page, 0).getByLabel("Medicine name")).toHaveCount(0); // the recorded name is shown, not editable
    await page.getByRole("button", { name: "Remove Typed Item" }).click();
    await page.getByTestId("remove-line-yes").click();
    await expect(page.getByTestId("save-changes")).toBeDisabled();
    await expect(page.getByText("must keep at least one line")).toBeVisible();
  });
});
