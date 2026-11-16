import { expect, signIn, test } from "./fixtures";
import { accountStore, addOpening } from "./account-helpers";

// User Story 7 of Module 007: who owes what, on Home and in the list. Mobile project only.
test.describe("US7: Home card for store accounts", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("with no store owing, Home says so and links to the list", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/");
    await expect(page.getByTestId("accounts-summary-text")).toHaveText("No store owes you anything.");
    await page.getByTestId("accounts-summary-link").click();
    await expect(page).toHaveURL(/\/accounts$/);
  });

  test("shows the total owed and the number of stores, and opens the list of stores that owe", async ({ page, freshTenant }) => {
    const one = await accountStore(freshTenant, "Nimer Medical");
    const two = await accountStore(freshTenant, "Al Shifa Pharmacy");
    await accountStore(freshTenant, "Quiet Store");
    await addOpening(freshTenant, one.id, "12000.00");
    await addOpening(freshTenant, two.id, "500.50");
    await signIn(page, freshTenant);
    await page.goto("/");
    await expect(page.getByTestId("accounts-summary-text")).toHaveText("PKR 12,500.50 owed by 2 stores");
    await page.getByTestId("accounts-summary-link").click();
    await expect(page).toHaveURL(/\/accounts\?owing=1/);
    await expect(page.getByTestId("account-item")).toHaveCount(2);
  });

  test("an error shows Retry and never says nothing is owed", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    let fail = true;
    await page.route("**/api/accounts/summary", (route) =>
      fail ? route.fulfill({ status: 500, json: { code: "server_error", message: "Something went wrong. Please try again." } }) : route.continue(),
    );
    await page.goto("/");
    await expect(page.getByTestId("accounts-summary-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("accounts-summary")).not.toContainText("No store owes you anything.");
    fail = false;
    await page.getByTestId("accounts-summary-error").getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("accounts-summary-text")).toHaveText("No store owes you anything.");
  });
});
