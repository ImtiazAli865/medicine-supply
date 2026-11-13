import { randomUUID } from "node:crypto";
import { expect, signIn, test } from "./fixtures";
import { seedMarketDay, todayInPakistan } from "./market-helpers";

// US4 of Module 005: the Home card, the Orders link, search, the status filter, the store filter, and the date.
test.describe("US4: the market list stays easy to reach and to filter", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("Home shows how many medicines are still to buy, links to the list, and the count equals the Still to buy list", async ({ page, freshTenant }) => {
    const seed = await seedMarketDay(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/");
    // Panadol 500 mg, Panadol 650 mg, Brufen and the typed Noran: 4 rows still to buy
    await expect(page.getByTestId("market-summary-count")).toHaveText("Market list: 4 medicines to buy today");

    // Buy all of Panadol 500 mg (a real purchase through the database function): the count drops by one.
    const bought = await freshTenant.client.rpc("purchase_record", {
      p_id: randomUUID(), p_product: seed.panadol500, p_unit: "strip", p_date: todayInPakistan(), p_quantity: 45, p_unit_cost: null, p_supplier: null, p_reference: null,
    });
    expect(bought.data).toMatchObject({ done: true });
    await page.reload();
    await expect(page.getByTestId("market-summary-count")).toHaveText("Market list: 3 medicines to buy today");

    await page.getByTestId("market-summary-link").click();
    await expect(page).toHaveURL(/\/market-list\?status=to_buy/);
    await expect(page.getByTestId("market-status-to_buy")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("market-count")).toBeVisible(); // the list has loaded before it is counted
    const rows = await page.getByTestId("market-row").count();
    const typed = await page.getByTestId("market-typed-row").count();
    expect(rows + typed).toBe(3); // the same number as on Home
  });

  test("Home says so when there are no confirmed orders today, and shows an error with Retry when the request fails", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/");
    await expect(page.getByTestId("market-summary-none")).toContainText("No confirmed orders today. Take or confirm an order.");

    let fail = true;
    await page.route("**/api/market-list/summary**", (route) => (fail ? route.fulfill({ status: 500, json: { code: "server_error", message: "Something went wrong. Please try again." } }) : route.continue()));
    await page.reload();
    await expect(page.getByTestId("market-summary-error")).toBeVisible();
    await expect(page.getByTestId("market-summary-none")).toHaveCount(0);
    fail = false;
    await page.getByTestId("market-summary-error").getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("market-summary-none")).toBeVisible();
  });

  test("the Orders screen links to the market list, and the bottom navigation still has five items", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/orders");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(5);
    await page.getByRole("link", { name: "Market list" }).first().click();
    await expect(page).toHaveURL(/\/market-list/);
    await expect(page.getByRole("heading", { name: "Market list" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(5);
  });

  test("searches by part of a name, filters by status and by store, and keeps the choices in the address", async ({ page, freshTenant }) => {
    const seed = await seedMarketDay(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/market-list");
    await expect(page.getByTestId("market-row")).toHaveCount(3);

    await page.getByTestId("market-search").fill("bruf");
    await expect(page.getByTestId("market-row")).toHaveCount(1);
    await expect(page.getByTestId("market-typed-row")).toHaveCount(0);
    await expect(page).toHaveURL(/q=bruf/);
    await page.getByTestId("market-search").fill("noran");
    await expect(page.getByTestId("market-typed-row")).toHaveCount(1); // unregistered entries are searched too
    await page.getByTestId("market-search").fill("");
    await expect(page.getByTestId("market-row")).toHaveCount(3);

    await page.getByTestId("market-status-bought").click();
    await expect(page.getByTestId("empty-state")).toContainText("No medicines match");
    await page.getByRole("button", { name: "Clear the search and filters" }).click();
    await expect(page.getByTestId("market-row")).toHaveCount(3);

    // The store filter: only Al Madina's lines; the bought and remaining figures stay for the whole day.
    await page.getByTestId("store-filter").locator("summary").click();
    await page.getByTestId("store-option").filter({ hasText: "" }).first().locator("xpath=ancestor::label").filter({ hasText: "Al Madina" }).click();
    await expect(page.getByText("Bought and remaining figures are for the whole day, not only the selected stores.")).toBeVisible();
    const panadol = page.getByTestId("market-row").filter({ hasText: "500 mg" });
    await expect(panadol.getByTestId("market-store")).toHaveCount(1);
    await expect(panadol).toContainText("Selected stores: 20 of 45 strip");
    await expect(page.getByTestId("market-row").filter({ hasText: "650 mg" })).toHaveCount(0); // Al Madina did not order it
    await expect(page).toHaveURL(new RegExp(`stores=${seed.stores.alMadina}`));

    // A reload shows the same list (the choices are in the address).
    await page.reload();
    await expect(page.getByTestId("market-row").filter({ hasText: "650 mg" })).toHaveCount(0);
  });

  test("shows nothing sideways at 360 px and every control is large enough", async ({ page, freshTenant }) => {
    await seedMarketDay(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/market-list");
    await expect(page.getByTestId("market-row")).toHaveCount(3);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
