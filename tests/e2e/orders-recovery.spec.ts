import { addMedicine, createOrder, line, seedMedicines, seedStore, setQuantity, startOrder, waitSaved } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US2: nothing is lost mid-entry, and the screen never claims more than the server confirmed.
test.describe("US2: automatic draft saving", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("a refresh keeps every saved line, quantity, unit and note", async ({ page, freshTenant }) => {
    await seedMedicines(freshTenant);
    await seedStore(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Al Shifa Pharmacy");
    await addMedicine(page, "panadol");
    await addMedicine(page, "brufen");
    await setQuantity(page, 1, "25");
    await page.getByLabel("Order notes (optional)").fill("Call before delivery");
    await waitSaved(page);

    await page.reload();
    await expect(page.getByTestId("order-heading")).toHaveText("ORD-0001");
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await expect(line(page, 1).getByLabel("Quantity")).toHaveValue("25");
    await expect(line(page, 1).getByLabel("Unit")).toHaveValue("box");
    await expect(page.getByLabel("Order notes (optional)")).toHaveValue("Call before delivery");
    await expect(page.getByTestId("save-status")).toContainText(/Saved at \d\d:\d\d/);
  });

  test("leaving and coming back: the draft is on Home as Continue order and opens exactly as left", async ({ page, freshTenant }) => {
    await seedMedicines(freshTenant);
    await seedStore(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Al Shifa Pharmacy");
    await addMedicine(page, "panadol");
    await waitSaved(page);

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home" }).click();
    await expect(page.getByTestId("continue-order")).toContainText("ORD-0001");
    await expect(page.getByTestId("continue-order")).toContainText("1 line");
    await page.getByTestId("continue-order").click();
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await expect(page.getByTestId("order-heading")).toHaveText("ORD-0001");

    // and it is in the history as a draft
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Orders" }).click();
    await page.getByRole("button", { name: "Draft", exact: true }).click();
    await expect(page.getByTestId("order-list-item")).toHaveCount(1);
  });

  test("opening New order and leaving without a change creates nothing", async ({ page, freshTenant }) => {
    await seedStore(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Al Shifa Pharmacy");
    await page.goto("/");
    const orders = await freshTenant.client.from("orders").select("id");
    expect(orders.data).toEqual([]);
    await expect(page.getByTestId("continue-orders")).toHaveCount(0);
  });

  test("with the network cut an edit shows Not saved, keeps the typed data, warns before leaving, and Retry saves it once", async ({ page, freshTenant }) => {
    await seedMedicines(freshTenant);
    await seedStore(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Al Shifa Pharmacy");
    await addMedicine(page, "panadol");
    await waitSaved(page);

    let blocked = true;
    await page.route("**/api/orders/*", (route) => (blocked && route.request().method() === "PUT" ? route.abort() : route.continue()));
    await setQuantity(page, 0, "9");
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "not_saved", { timeout: 30_000 });
    await expect(page.getByTestId("save-status")).toContainText("Not saved");
    await expect(page.getByText(/Saved at/)).toHaveCount(0);
    await expect(line(page, 0).getByLabel("Quantity")).toHaveValue("9"); // still on screen

    // the page warns before it is closed or reloaded
    const warned = await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(warned).toBe(true);

    blocked = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await waitSaved(page);
    const lines = await freshTenant.client.from("order_lines").select("quantity").is("removed_at", null);
    expect(lines.data).toEqual([{ quantity: 9 }]); // one line, saved once
    const noWarning = await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(noWarning).toBe(false);
  });

  test("an edit typed while the connection is failing is saved after it returns, with no false 'changed elsewhere'", async ({ page, freshTenant }) => {
    await seedMedicines(freshTenant);
    await seedStore(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Al Shifa Pharmacy");
    await addMedicine(page, "panadol");
    await waitSaved(page);

    let blocked = true;
    await page.route("**/api/orders/*", (route) => (blocked && route.request().method() === "PUT" ? route.abort() : route.continue()));
    await setQuantity(page, 0, "4");
    await page.waitForTimeout(1200);
    await setQuantity(page, 0, "6"); // a second edit while the first is still being retried
    blocked = false;
    await waitSaved(page);
    await expect(page.getByTestId("save-status")).not.toHaveAttribute("data-state", "changed_elsewhere");
    const lines = await freshTenant.client.from("order_lines").select("quantity").is("removed_at", null);
    expect(lines.data).toEqual([{ quantity: 6 }]);
  });

  test("the same draft open in two pages: the second save is told it changed elsewhere and nothing is overwritten", async ({ page, context, freshTenant }) => {
    const catalog = await seedMedicines(freshTenant);
    const storeId = await seedStore(freshTenant);
    const order = await createOrder(freshTenant, storeId, [{ product_id: catalog.pricedId, quantity: 1, unit: "strip" }]);
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    await expect(line(page, 0).getByLabel("Quantity")).toHaveValue("1");

    const other = await context.newPage();
    await other.goto(`/orders/${order.id}`);
    await setQuantity(other, 0, "5");
    await waitSaved(other);

    await setQuantity(page, 0, "9"); // this page is still on the old version
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "changed_elsewhere", { timeout: 15_000 });
    await expect(line(page, 0).getByLabel("Quantity")).toHaveValue("9"); // its text is not thrown away
    const stored = await freshTenant.client.from("order_lines").select("quantity").is("removed_at", null);
    expect(stored.data).toEqual([{ quantity: 5 }]); // the other page's change was not overwritten

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Review the current order" }).click();
    await expect(line(page, 0).getByLabel("Quantity")).toHaveValue("5");
    await expect(page.getByTestId("save-status")).toContainText(/Saved at/);
  });

  test("two drafts for two stores keep only their own lines", async ({ page, freshTenant }) => {
    const catalog = await seedMedicines(freshTenant);
    const one = await seedStore(freshTenant, "Store One");
    const two = await seedStore(freshTenant, "Store Two");
    const first = await createOrder(freshTenant, one, [{ product_id: catalog.pricedId, quantity: 1, unit: "strip" }]);
    const second = await createOrder(freshTenant, two, [{ product_id: catalog.sellingOnlyId, quantity: 2, unit: "box" }]);
    await signIn(page, freshTenant);
    await page.goto(`/orders/${first.id}`);
    await expect(page.getByTestId("order-store")).toContainText("Store One");
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await expect(page.getByTestId("line-name")).toHaveCount(1);
    await expect(page.getByText("Panadol 500mg")).toBeVisible();
    await page.goto(`/orders/${second.id}`);
    await expect(page.getByTestId("order-store")).toContainText("Store Two");
    await expect(page.getByText("Brufen 400mg")).toBeVisible();
    await expect(page.getByText("Panadol 500mg")).toHaveCount(0);
  });

  test("the store can be changed while there are no lines, and is locked once there is one", async ({ page, freshTenant }) => {
    await seedMedicines(freshTenant);
    await seedStore(freshTenant, "Store One");
    await seedStore(freshTenant, "Store Two");
    await signIn(page, freshTenant);
    await startOrder(page, "Store One");
    await page.getByTestId("change-store").click();
    await page.getByRole("dialog").getByTestId("store-option").filter({ hasText: "Store Two" }).click();
    // nothing was saved yet, so the screen starts over with the other store
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?store=/);
    await expect(page.getByTestId("order-store")).toContainText("Store Two");
    await expect(page.getByTestId("add-medicine")).toBeEnabled();

    await addMedicine(page, "panadol");
    await waitSaved(page);
    await expect(page.getByTestId("change-store")).toHaveCount(0);
    await expect(page.getByTestId("store-locked-note")).toContainText("cannot be changed");
    await page.getByRole("link", { name: "Start a new order for another store" }).click();
    await expect(page).toHaveURL(/\/orders\/new$/);
  });

  test("discarding a draft asks first, keeps it in the history as Cancelled, and does not erase it", async ({ page, freshTenant }) => {
    await seedMedicines(freshTenant);
    await seedStore(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Al Shifa Pharmacy");
    await addMedicine(page, "panadol");
    await waitSaved(page);
    await page.getByTestId("discard-draft").click();
    await expect(page.getByRole("dialog")).toContainText("Discard this draft?");
    await page.getByTestId("cancel-order-yes").click();
    await expect(page.getByTestId("order-status")).toContainText("Cancelled");
    await expect(page.getByTestId("cancel-reason")).toContainText("cannot be changed");
    await expect(page.getByTestId("edit-order")).toHaveCount(0);

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Orders" }).click();
    await page.getByRole("button", { name: "Cancelled", exact: true }).click();
    await expect(page.getByTestId("order-list-item")).toHaveCount(1);
    const stored = await freshTenant.client.from("orders").select("status");
    expect(stored.data).toEqual([{ status: "cancelled" }]);
  });
});
