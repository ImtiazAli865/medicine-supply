import { expect, signIn, test } from "./fixtures";
import { confirmedOrder, makeInvoice, seedInvoiceWorld, type InvoiceSeed } from "./invoice-helpers";
import { createOrder, seedStore } from "./orders-helpers";
import type { TestTenant } from "../helpers/supabase-test";

// US5 of Module 006: the Invoices screen (list, filters, search, "To invoice" tab, states). Mobile project (360 px) only.
test.describe("US5: invoices list", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  /** A draft (Al Madina), an issued invoice (Shah Medical), an issued and then cancelled one (Al Madina), and a waiting order (Shah). */
  async function seedList(tenant: TestTenant): Promise<{ seed: InvoiceSeed; shah: string; waiting: string }> {
    const seed = await seedInvoiceWorld(tenant, "Al Madina Medical");
    const shah = await seedStore(tenant, "Shah Medical");
    const draftOrder = await confirmedOrder(tenant, seed);
    await makeInvoice(tenant, draftOrder.id, "draft");
    const issuedOrder = await createOrder(tenant, shah, [{ product_id: seed.pricedId, quantity: 4, unit: "strip" }], { confirm: true });
    await makeInvoice(tenant, issuedOrder.id, "issued");
    const cancelledOrder = await confirmedOrder(tenant, seed);
    await makeInvoice(tenant, cancelledOrder.id, "cancelled");
    const waiting = await createOrder(tenant, shah, [{ product_id: seed.sellingOnlyId, quantity: 2, unit: "box" }], { confirm: true });
    return { seed, shah, waiting: waiting.id };
  }

  const headings = (page: import("@playwright/test").Page) => page.getByTestId("invoice-item-heading").allInnerTexts();

  test("lists invoices newest first with number or Draft, store, total and status", async ({ page, freshTenant }) => {
    await seedList(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/invoices");
    await expect(page.getByTestId("invoice-item")).toHaveCount(3);
    expect(await headings(page)).toEqual(["INV-000002", "INV-000001", "Draft invoice"]);
    await expect(page.getByTestId("invoice-item").nth(0)).toContainText("Cancelled");
    await expect(page.getByTestId("invoice-item").nth(1)).toContainText("Shah Medical");
    await expect(page.getByTestId("invoice-item").nth(1)).toContainText("PKR 502.00");
    await expect(page.getByTestId("invoice-item").nth(2)).toContainText("Al Madina Medical");
    await expect(page.getByTestId("invoice-item").nth(2)).toContainText("PKR 2,805.00");
    await page.getByTestId("invoice-item").nth(1).click();
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("invoice-heading")).toHaveText("INV-000001");
  });

  test("filters by status, store and date, and searches by number and store name", async ({ page, freshTenant }) => {
    await seedList(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/invoices");
    await expect(page.getByTestId("invoice-item")).toHaveCount(3);

    await page.getByTestId("status-issued").click();
    await expect(page.getByTestId("invoice-item-heading")).toHaveText(["INV-000001"]);
    await page.getByTestId("status-draft").click();
    await expect(page.getByTestId("invoice-item-heading")).toHaveText(["Draft invoice"]);
    await page.getByTestId("status-cancelled").click();
    await expect(page.getByTestId("invoice-item-heading")).toHaveText(["INV-000002"]);
    await page.getByTestId("status-all").click();
    await expect(page.getByTestId("invoice-item")).toHaveCount(3);

    await page.getByLabel("Search invoices").fill("INV-000001");
    await expect(page.getByTestId("invoice-item")).toHaveCount(1);
    await page.getByLabel("Search invoices").fill("madina");
    await expect(page.getByTestId("invoice-item")).toHaveCount(2);
    await page.getByLabel("Search invoices").fill("");
    await expect(page.getByTestId("invoice-item")).toHaveCount(3);

    await page.getByTestId("filter-store").click();
    await page.getByRole("dialog").getByTestId("store-option").filter({ hasText: "Shah Medical" }).first().click();
    await expect(page.getByTestId("store-chip")).toContainText("Shah Medical");
    await expect(page.getByTestId("invoice-item")).toHaveCount(1);
    await page.getByTestId("store-chip").click();
    await expect(page.getByTestId("invoice-item")).toHaveCount(3);

    // A date range in the future matches nothing and offers to clear the filters.
    await page.getByLabel("From").fill("2099-01-01");
    await expect(page.getByText("No invoices match")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByTestId("invoice-item")).toHaveCount(3);
  });

  test("the To invoice tab lists the confirmed orders without an issued invoice and creates or opens drafts", async ({ page, freshTenant }) => {
    const { waiting } = await seedList(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/invoices?tab=to-invoice");
    // The draft's order, the cancelled invoice's order (confirmed again) and the waiting order.
    await expect(page.getByTestId("to-invoice-item")).toHaveCount(3);
    await expect(page.getByTestId("tab-to-invoice")).toHaveText("To invoice (3)");
    await expect(page.getByTestId("open-draft")).toHaveCount(1);
    await expect(page.getByTestId("create-invoice-row")).toHaveCount(2);

    await page.getByLabel("Search invoices").fill("shah");
    await expect(page.getByTestId("to-invoice-item")).toHaveCount(1);
    await expect(page.getByTestId("to-invoice-item")).toHaveAttribute("data-order-id", waiting);
    await page.getByTestId("create-invoice-row").click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("invoice-heading")).toHaveText("Draft invoice");
  });

  test("shows empty states with the next action", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/invoices");
    await expect(page.getByText("No invoices yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to orders" })).toBeVisible();
    await page.getByTestId("tab-to-invoice").click();
    await expect(page.getByText("Nothing waiting for an invoice")).toBeVisible();
  });

  test("shows a loading state and an error with Retry, never a blank screen", async ({ page, freshTenant }) => {
    await seedList(freshTenant);
    await signIn(page, freshTenant);
    let fail = true;
    await page.route("**/api/invoices?**", (route) => (fail ? route.fulfill({ status: 500, json: { code: "server_error", message: "Something went wrong. Please try again." } }) : route.continue()));
    await page.goto("/invoices");
    await expect(page.getByTestId("error-state")).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("invoice-item")).toHaveCount(3);
  });

  test("is reachable from the Orders screen and keeps five bottom navigation items", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/orders");
    await page.getByTestId("invoices-link").click();
    await expect(page).toHaveURL(/\/invoices$/);
    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(5);
  });
});
