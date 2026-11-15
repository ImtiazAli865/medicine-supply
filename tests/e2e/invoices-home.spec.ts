import { expect, signIn, test } from "./fixtures";
import { confirmedOrder, makeInvoice, seedInvoiceWorld } from "./invoice-helpers";

// US5 of Module 006: the Home card. The count on Home equals the length of the "To invoice" list. Mobile project only.
test.describe("US5: invoices on Home", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("shows how many orders wait for an invoice, equal to the To invoice list, and links to it", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const one = await confirmedOrder(freshTenant, seed);
    await confirmedOrder(freshTenant, seed);
    const issued = await confirmedOrder(freshTenant, seed);
    await makeInvoice(freshTenant, issued.id, "issued");
    await makeInvoice(freshTenant, one.id, "draft");
    await signIn(page, freshTenant);

    await page.goto("/");
    await expect(page.getByTestId("invoice-summary-count")).toHaveText("2 orders to invoice");
    await page.getByTestId("invoice-summary-link").click();
    await expect(page).toHaveURL(/\/invoices\?tab=to-invoice$/);
    await expect(page.getByTestId("to-invoice-item")).toHaveCount(2);
    await expect(page.getByTestId("tab-to-invoice")).toHaveText("To invoice (2)");

    // Issuing one of them lowers the count on Home.
    await page.getByTestId("open-draft").click();
    await page.getByTestId("issue-invoice").click();
    await page.getByTestId("issue-confirm").click();
    await expect(page.getByTestId("invoice-view")).toBeVisible({ timeout: 15_000 });
    await page.goto("/");
    await expect(page.getByTestId("invoice-summary-count")).toHaveText("1 order to invoice");
  });

  test("says so when nothing waits for an invoice, and shows an error with Retry when the count cannot be read", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/");
    await expect(page.getByTestId("invoice-summary-count")).toHaveText("No orders waiting for an invoice.");

    let fail = true;
    await page.route("**/api/invoices/summary", (route) => (fail ? route.fulfill({ status: 500, json: { code: "server_error", message: "Something went wrong. Please try again." } }) : route.continue()));
    await page.reload();
    await expect(page.getByTestId("invoice-summary-error")).toBeVisible();
    fail = false;
    await page.getByTestId("invoice-summary-error").getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("invoice-summary-count")).toBeVisible();
  });
});
