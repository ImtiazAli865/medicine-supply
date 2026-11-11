import { expect, signIn, test } from "./fixtures";

// FR-025: every list has loading, error (with Retry) and empty states, and never a blank screen.
for (const list of [
  { name: "stores", path: "/stores", api: "**/api/stores?**", empty: "Add your first store" },
  { name: "products", path: "/products", api: "**/api/products?**", empty: "Add your first medicine" },
  { name: "orders", path: "/orders", api: "**/api/orders?**", empty: "Take your first order", noMatch: /No orders match/ },
]) {
  test.describe(`${list.name} list states`, () => {
    test.beforeEach(async ({ page, tenant }) => {
      await signIn(page, tenant);
    });

    test("shows a loading indicator while the request is pending", async ({ page }) => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      await page.route(list.api, async (route) => {
        await gate;
        await route.continue();
      });
      await page.goto(list.path);
      await expect(page.getByTestId("loading")).toBeVisible();
      await expect(page.getByTestId("empty-state")).toHaveCount(0);
      release();
      await expect(page.getByTestId("loading")).toHaveCount(0);
    });

    test("shows an error with Retry (not the empty state) when the request fails, then recovers", async ({ page }) => {
      let fail = true;
      await page.route(list.api, (route) => (fail ? route.fulfill({ status: 500, json: { code: "server_error", message: "Something went wrong. Please try again." } }) : route.continue()));
      await page.goto(list.path);
      await expect(page.getByTestId("error-state")).toBeVisible();
      await expect(page.getByTestId("empty-state")).toHaveCount(0);
      fail = false;
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByTestId("error-state")).toHaveCount(0);
    });

    test("shows the empty state with the next action when there are no records", async ({ page }) => {
      await page.route(list.api, (route) => route.fulfill({ status: 200, json: { items: [], next_cursor: null } }));
      await page.goto(list.path);
      const empty = page.getByTestId("empty-state");
      await expect(empty).toContainText(list.empty);
      await expect(empty.getByRole("link", { name: list.empty })).toBeVisible();
    });

    test("a search with no matches shows its own 'no match' message, not the first-time empty state", async ({ page }) => {
      await page.route(list.api, (route) => route.fulfill({ status: 200, json: { items: [], next_cursor: null } }));
      await page.goto(list.path);
      await page.getByRole("searchbox").fill("zzzz-nothing");
      await expect(page.getByTestId("empty-state")).toContainText(list.noMatch ?? /No .* found/);
    });
  });
}
