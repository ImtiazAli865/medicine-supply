import { createOrder, seedMedicines, seedStore } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US5: order history, store by store.
test.describe("US5: order history", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("lists orders newest first with number, store, status, size and the total of priced lines", async ({ page, freshTenant }) => {
    const catalog = await seedMedicines(freshTenant);
    const store = await seedStore(freshTenant);
    const first = await createOrder(freshTenant, store, [{ product_id: catalog.pricedId, quantity: 2, unit: "strip" }], { confirm: true });
    const second = await createOrder(freshTenant, store, [
      { product_id: catalog.pricedId, quantity: 1, unit: "strip" },
      { product_id: catalog.noPriceId, quantity: 1, unit: "bottle" },
    ]);
    await signIn(page, freshTenant);
    await page.goto("/orders");
    const items = page.getByTestId("order-list-item");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("ORD-0002");
    await expect(items.nth(0)).toContainText("Draft");
    await expect(items.nth(0)).toContainText("Al Shifa Pharmacy");
    await expect(items.nth(0)).toContainText("2 lines");
    await expect(items.nth(0)).toContainText("PKR 125.50");
    await expect(items.nth(0)).toContainText("1 without price");
    await expect(items.nth(1)).toContainText("ORD-0001");
    await expect(items.nth(1)).toContainText("Confirmed");
    await expect(items.nth(1)).toContainText("PKR 251.00");
    expect(first.number).toBe(1);
    expect(second.number).toBe(2);
  });

  test("filters by store, status and Today, and searches by order number and store name", async ({ page, freshTenant }) => {
    const catalog = await seedMedicines(freshTenant);
    const one = await seedStore(freshTenant, "Alpha Pharmacy");
    const two = await seedStore(freshTenant, "Beta Medical");
    const line = [{ product_id: catalog.pricedId, quantity: 1, unit: "strip" }];
    await createOrder(freshTenant, one, line, { confirm: true }); // 1
    await createOrder(freshTenant, two, line); // 2
    await createOrder(freshTenant, one, line); // 3
    await signIn(page, freshTenant);
    await page.goto("/orders");
    await expect(page.getByTestId("order-list-item")).toHaveCount(3);

    await page.getByRole("button", { name: "Draft", exact: true }).click();
    await expect(page.getByTestId("order-list-item")).toHaveCount(2);
    await page.getByRole("button", { name: "Confirmed", exact: true }).click();
    await expect(page.getByTestId("order-list-item")).toHaveCount(1);
    await page.getByRole("button", { name: "All", exact: true }).click();

    await page.getByTestId("filter-store").click();
    await page.getByRole("dialog").getByTestId("store-option").filter({ hasText: "Beta Medical" }).click();
    await expect(page.getByTestId("order-list-item")).toHaveCount(1);
    await expect(page.getByTestId("order-list-item")).toContainText("Beta Medical");
    await page.getByTestId("store-chip").click();
    await expect(page.getByTestId("order-list-item")).toHaveCount(3);

    await page.getByRole("button", { name: "Today" }).click();
    await expect(page.getByTestId("order-list-item")).toHaveCount(3);

    await page.getByLabel("Search orders").fill("ORD-0002");
    await expect(page.getByTestId("order-list-item")).toHaveCount(1);
    await expect(page.getByTestId("order-list-number")).toHaveText("ORD-0002");
    await page.getByLabel("Search orders").fill("alpha");
    await expect(page.getByTestId("order-list-item")).toHaveCount(2);
    await page.getByLabel("Search orders").fill("zzz-nothing");
    await expect(page.getByTestId("empty-state")).toContainText("No orders match");
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByTestId("order-list-item")).toHaveCount(3);
  });

  test("a date range in the past shows nothing, with a way to clear the filters", async ({ page, freshTenant }) => {
    const catalog = await seedMedicines(freshTenant);
    const store = await seedStore(freshTenant);
    await createOrder(freshTenant, store, [{ product_id: catalog.pricedId, quantity: 1, unit: "strip" }]);
    await signIn(page, freshTenant);
    await page.goto("/orders?from=2020-01-01&to=2020-01-31");
    await expect(page.getByTestId("empty-state")).toContainText("No orders match");
    await expect(page.getByLabel("From")).toHaveValue("2020-01-01");
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByTestId("order-list-item")).toHaveCount(1);
  });

  test("opening an order only displays it: draft offers Continue, confirmed shows details, nothing changes", async ({ page, freshTenant }) => {
    const catalog = await seedMedicines(freshTenant);
    const store = await seedStore(freshTenant);
    const draft = await createOrder(freshTenant, store, [{ product_id: catalog.pricedId, quantity: 2, unit: "strip" }], { notes: "draft note" });
    const confirmed = await createOrder(freshTenant, store, [{ product_id: catalog.sellingOnlyId, quantity: 1, unit: "box" }], { confirm: true, notes: "confirmed note" });
    await signIn(page, freshTenant);
    await page.goto("/orders");
    const before = await freshTenant.client.from("orders").select("id, version, updated_at").order("order_number");

    await page.getByTestId("order-list-item").filter({ hasText: "ORD-0002" }).click();
    await expect(page.getByTestId("order-heading")).toHaveText("ORD-0002");
    await expect(page.getByTestId("order-status")).toContainText("Confirmed");
    await expect(page.getByTestId("order-notes")).toHaveText("confirmed note");
    await expect(page.getByTestId("edit-order")).toBeVisible();
    await page.goBack();
    await page.getByTestId("order-list-item").filter({ hasText: "ORD-0001" }).click();
    await expect(page.getByTestId("order-heading")).toHaveText("ORD-0001");
    await expect(page.getByTestId("order-status")).toContainText("Draft");
    await expect(page.getByLabel("Order notes (optional)")).toHaveValue("draft note");
    await expect(page.getByTestId("save-status")).toContainText(/Saved at/);

    const after = await freshTenant.client.from("orders").select("id, version, updated_at").order("order_number");
    expect(after.data).toEqual(before.data); // viewing changed nothing
    expect(draft.number).toBe(1);
    expect(confirmed.number).toBe(2);
  });

  test("an empty history says so and offers the first order; the store page links to that store's orders", async ({ page, freshTenant }) => {
    const store = await seedStore(freshTenant, "Gamma Store");
    await signIn(page, freshTenant);
    await page.goto("/orders");
    await expect(page.getByTestId("empty-state")).toContainText("No orders yet");
    await page.getByRole("link", { name: "Take your first order" }).click();
    await expect(page).toHaveURL(/\/orders\/new$/);

    await page.goto(`/stores/${store}`);
    await page.getByRole("main").getByRole("link", { name: "Orders" }).click();
    await expect(page).toHaveURL(new RegExp(`/orders\\?store=${store}`));
    await expect(page.getByTestId("store-chip")).toContainText("Gamma Store");
  });

  test("a failed history request shows an error with Retry, then recovers", async ({ page, freshTenant }) => {
    const catalog = await seedMedicines(freshTenant);
    const store = await seedStore(freshTenant);
    await createOrder(freshTenant, store, [{ product_id: catalog.pricedId, quantity: 1, unit: "strip" }]);
    await signIn(page, freshTenant);
    let fail = true;
    await page.route("**/api/orders?**", (route) => (fail ? route.fulfill({ status: 500, json: { code: "server_error", message: "Something went wrong. Please try again." } }) : route.continue()));
    await page.goto("/orders");
    await expect(page.getByTestId("error-state")).toBeVisible();
    await expect(page.getByTestId("empty-state")).toHaveCount(0);
    fail = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("order-list-item")).toHaveCount(1);
  });
});

test.describe("US5: order history states", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("shows a loading indicator while the history is loading, never a blank or the empty state", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/orders?**", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/orders");
    await expect(page.getByTestId("loading")).toBeVisible();
    await expect(page.getByTestId("empty-state")).toHaveCount(0);
    release();
    await expect(page.getByTestId("loading")).toHaveCount(0);
    await expect(page.getByTestId("empty-state")).toContainText("No orders yet");
  });
});
