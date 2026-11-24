import { expect, signIn, test } from "./fixtures";
import { seedReportWorld } from "./reports-helpers";

// Honest states of every report screen (spec FR-021, SC-007): an error with Retry that never shows a zero, an empty
// state that names the next action, and "Reports need the internet" when the network fails (no old numbers).
test.describe("report states", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  const SCREENS: Array<{ path: string; api: string; emptyText: RegExp }> = [
    { path: "/reports/sales", api: "**/api/reports/sales**", emptyText: /No issued invoices in this period/ },
    { path: "/reports/purchases", api: "**/api/reports/purchases**", emptyText: /No purchases recorded in this period/ },
    { path: "/reports/stores", api: "**/api/reports/stores**", emptyText: /No sales to any store in this period/ },
    { path: "/reports/medicines", api: "**/api/reports/medicines**", emptyText: /No medicines sold in this period/ },
    { path: "/reports/cost-missing", api: "**/api/reports/cost-missing**", emptyText: /No cost is missing in this period/ },
  ];

  for (const screen of SCREENS) {
    test(`${screen.path}: an empty business sees the empty state with a next action`, async ({ page, freshTenant }) => {
      await signIn(page, freshTenant);
      await page.goto(screen.path);
      await expect(page.getByTestId("report-empty")).toContainText(screen.emptyText);
      await expect(page.getByTestId("report-empty").getByRole("link").first()).toBeVisible();
      await expect(page.getByTestId("report-export")).toHaveCount(0); // nothing to export
    });

    test(`${screen.path}: a failed load shows an error with Retry, never a zero, and Retry recovers`, async ({ page, freshTenant }) => {
      await seedReportWorld(freshTenant);
      await signIn(page, freshTenant);
      let fail = true;
      await page.route(screen.api, (route) => (fail ? route.fulfill({ status: 500, json: { code: "server_error", message: "Something went wrong. Please try again." } }) : route.continue()));
      await page.goto(screen.path);
      await expect(page.getByTestId("report-error")).toContainText("Something went wrong");
      await expect(page.getByTestId("report-total-sales")).toHaveCount(0);
      await expect(page.getByTestId("report-export")).toHaveCount(0);
      fail = false;
      await page.getByTestId("report-error").getByRole("button", { name: "Retry" }).click();
      await expect(page.getByTestId("report-error")).toHaveCount(0);
      await expect(page.getByTestId("report-empty")).toHaveCount(0);
    });

    test(`${screen.path}: when the network fails it says Reports need the internet and shows no numbers`, async ({ page, freshTenant }) => {
      await seedReportWorld(freshTenant);
      await signIn(page, freshTenant);
      await page.goto(screen.path);
      await expect(page.getByTestId("report-error")).toHaveCount(0);
      await page.route(screen.api, (route) => route.abort("internetdisconnected"));
      await page.getByTestId("report-period").getByRole("button", { name: "Today" }).click();
      await expect(page.getByTestId("report-error")).toContainText("Reports need the internet");
      await expect(page.getByTestId("report-total-sales")).toHaveCount(0);
      await expect(page.getByTestId("report-rows")).toHaveCount(0);
      await expect(page.getByTestId("report-export")).toHaveCount(0);
    });
  }

  test("/reports/balances: a business with no stores sees what to do next, and a failed load is an error", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/reports/balances");
    await expect(page.getByTestId("report-empty")).toContainText("No stores yet");
    await expect(page.getByTestId("report-empty").getByRole("link", { name: "Add a store" })).toBeVisible();

    await page.route("**/api/accounts/summary**", (route) => route.fulfill({ status: 500, json: { code: "server_error", message: "Something went wrong. Please try again." } }));
    await page.reload();
    await expect(page.getByTestId("report-error")).toBeVisible();
    await expect(page.getByTestId("balances-total")).toHaveCount(0);
  });

  test("the hub, the Home card and the Settings link open Reports, and the Home card shows no number", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/");
    const card = page.getByRole("link", { name: /Reports/ }).first();
    await expect(card).toContainText("Your sales and what stores owe.");
    expect(await card.innerText()).not.toMatch(/\d/);
    // The Home screen is held to the same rule as every order screen: no word about purchase, cost, margin or profit.
    expect(await page.locator("body").innerText()).not.toMatch(/purchase|MRP|margin|profit|cost/i);
    await card.click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByTestId("reports-hub").getByRole("link")).toHaveCount(6);

    await page.goto("/settings");
    await page.getByTestId("settings-reports-link").click();
    await expect(page).toHaveURL(/\/reports$/);
  });
});
