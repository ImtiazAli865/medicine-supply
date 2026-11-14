import { expect, signIn, test } from "./fixtures";
import { confirmedOrder, makeInvoice, seedInvoiceWorld } from "./invoice-helpers";

// Module 006: the invoice screens have a loading state, an error with Retry, a not-found state and an empty state.
test.describe("Module 006: invoice states", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("the invoice screen shows loading, then an error with Retry that recovers, and Invoice not found for an unknown id", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    const invoiceId = await makeInvoice(freshTenant, order.id, "draft");
    await signIn(page, freshTenant);

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let fail = true;
    await page.route(`**/api/invoices/${invoiceId}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await gate;
      if (fail) return route.fulfill({ status: 500, json: { code: "server_error", message: "Something went wrong. Please try again." } });
      return route.continue();
    });
    await page.goto(`/invoices/${invoiceId}`);
    await expect(page.getByText("Loading invoice…")).toBeVisible();
    release();
    await expect(page.getByTestId("error-state")).toBeVisible();
    fail = false;
    await page.getByTestId("error-state").getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("invoice-editor")).toBeVisible();

    await page.goto("/invoices/00000000-0000-4000-8000-000000000000");
    await expect(page.getByText("Invoice not found")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to orders" })).toBeVisible();
  });

  test("the invoice part of the order screen shows an error with Retry instead of hiding the problem", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    let fail = true;
    await page.route("**/api/invoices?**", (route) => (fail ? route.fulfill({ status: 500, json: { code: "server_error", message: "Something went wrong. Please try again." } }) : route.continue()));
    await page.goto(`/orders/${order.id}`);
    await expect(page.getByTestId("order-invoice-error")).toBeVisible();
    await expect(page.getByTestId("create-invoice")).toHaveCount(0);
    fail = false;
    await page.getByTestId("order-invoice-error").getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("create-invoice")).toBeVisible();
  });
});
