import { expect, signIn, smallTargets, test } from "./fixtures";
import { confirmedOrder, seedInvoiceWorld } from "./invoice-helpers";
import { createOrder } from "./orders-helpers";

// Module 006: the invoice screens, their dialogs and the print pages at 360 px: every interactive control is at least
// 44 x 44 px, nothing scrolls sideways, and the bottom navigation keeps its five items.
test.describe("Module 006: invoice touch targets and layout at 360 px", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("home card, order action, draft, dialogs, issued invoice, lists and print pages", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed, [
      { product_id: seed.pricedId, quantity: 10, unit: "strip" },
      { product_id: null, name: "Noran 20mg cap", quantity: 3, unit: "strip" },
    ]);
    const clean = await confirmedOrder(freshTenant, seed);
    await createOrder(freshTenant, seed.storeId, [{ product_id: seed.pricedId, quantity: 1, unit: "strip" }], { confirm: true });
    await signIn(page, freshTenant);

    const check = async (label: string) => {
      expect(await smallTargets(page), `small targets: ${label}`).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `horizontal overflow: ${label}`).toBeLessThanOrEqual(1);
    };

    await page.goto("/");
    await expect(page.getByTestId("invoice-summary-count")).toBeVisible();
    await check("home with the invoice card");

    await page.goto(`/orders/${order.id}`);
    await expect(page.getByTestId("create-invoice")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await check("order screen with Create invoice");

    await page.getByTestId("create-invoice").click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("invoice-blockers")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await check("draft with blockers");
    await page.getByTestId("discard-invoice").click();
    await expect(page.getByRole("dialog")).toContainText("Discard this draft?");
    await check("discard dialog");
    await page.keyboard.press("Escape");

    await page.goto(`/orders/${clean.id}`);
    await page.getByTestId("create-invoice").click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("issue-invoice")).toBeEnabled();
    await check("ready draft");
    await page.getByTestId("issue-invoice").click();
    await expect(page.getByRole("dialog")).toContainText("Issue this invoice?");
    await check("issue dialog");
    await page.getByTestId("issue-confirm").click();
    await expect(page.getByTestId("invoice-view")).toBeVisible({ timeout: 15_000 });
    await check("issued invoice");
    await page.getByTestId("cancel-invoice").click();
    await expect(page.getByRole("dialog")).toContainText("Cancel INV-000001?");
    await check("cancel invoice dialog");
    await page.keyboard.press("Escape");

    const invoiceId = page.url().split("/").pop() as string;
    for (const layout of ["a4", "thermal"]) {
      await page.goto(`/invoices/${invoiceId}/print?layout=${layout}`);
      await expect(page.getByTestId("invoice-print")).toBeVisible();
      await check(`invoice print page (${layout})`);
    }

    await page.goto("/invoices");
    // The first draft was not discarded (the dialog was closed), so there are two invoices: that draft and the issued one.
    await expect(page.getByTestId("invoice-item")).toHaveCount(2);
    await page.waitForLoadState("networkidle");
    await check("invoices list");
    await page.getByTestId("filter-store").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await check("invoices store filter dialog");
    await page.keyboard.press("Escape");
    await page.getByTestId("tab-to-invoice").click();
    await expect(page.getByTestId("to-invoice-item").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await check("to invoice list");

    await page.goto(`/orders/${order.id}/print`);
    await expect(page.getByTestId("order-sheet")).toBeVisible();
    await check("order sheet (option A)");
    await page.goto("/orders/print");
    await expect(page.getByTestId("order-sheet")).toBeVisible();
    await page.getByTestId("store-filter").locator("summary").click();
    await check("order sheets for a day (option B) with the store filter open");
  });

  test("the empty invoice screens", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/invoices");
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await smallTargets(page)).toEqual([]);
    await page.getByTestId("tab-to-invoice").click();
    await expect(page.getByTestId("empty-state")).toBeVisible();
    expect(await smallTargets(page)).toEqual([]);
    await page.goto("/orders/print");
    await expect(page.getByTestId("empty-state")).toBeVisible();
    expect(await smallTargets(page)).toEqual([]);
  });

  test("the main navigation still has exactly five items on the invoice screens", async ({ page, tenant }) => {
    await signIn(page, tenant);
    for (const path of ["/invoices", "/orders/print"]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(5);
    }
  });
});
