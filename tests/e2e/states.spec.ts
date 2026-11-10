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

// Module 004 (SC-012): the two Pending lists and the Home card have loading, error (with Retry) and empty states.
for (const list of [
  { name: "Pending: Need a price", path: "/pending?tab=prices", api: "**/api/pending/prices?**", empty: "Nothing needs a price", action: "Add a medicine", noMatch: /No medicines found/ },
  { name: "Pending: To register", path: "/pending?tab=register", api: "**/api/pending/typed?**", empty: "Nothing to register", action: "Take an order", noMatch: /No typed medicines match/ },
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
      await expect(page.getByTestId("loading").first()).toBeVisible();
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
      await expect(empty.getByRole("link", { name: list.action })).toBeVisible();
    });

    test("a search with no matches shows its own 'no match' message, not the first-time empty state", async ({ page }) => {
      await page.route(list.api, (route) => route.fulfill({ status: 200, json: { items: [], next_cursor: null } }));
      await page.goto(list.path);
      await page.getByRole("searchbox").fill("zzzz-nothing");
      await expect(page.getByTestId("empty-state")).toContainText(list.noMatch);
    });
  });
}

test.describe("Home: Needs attention card states", () => {
  test.beforeEach(async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
  });

  test("shows a loading placeholder while the summary is pending, then the result", async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/pending/summary", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/");
    await expect(page.getByTestId("pending-summary-loading")).toBeVisible();
    await expect(page.getByTestId("pending-summary-clear")).toHaveCount(0);
    release();
    await expect(page.getByTestId("pending-summary-loading")).toHaveCount(0);
    await expect(page.getByTestId("pending-summary-clear")).toBeVisible();
  });

  test("shows an error with Retry (never 'nothing needs attention') when the request fails, then recovers", async ({ page }) => {
    let fail = true;
    await page.route("**/api/pending/summary", (route) => (fail ? route.fulfill({ status: 500, json: { code: "server_error", message: "Something went wrong. Please try again." } }) : route.continue()));
    await page.goto("/");
    await expect(page.getByTestId("pending-summary-error")).toBeVisible();
    await expect(page.getByTestId("pending-summary-clear")).toHaveCount(0);
    fail = false;
    await page.getByTestId("pending-summary-error").getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("pending-summary-clear")).toBeVisible();
  });
});
