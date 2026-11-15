import { expect, signIn, test } from "./fixtures";
import { cancelOrder, confirmedOrder, createDraftFromOrder, editFirstLineQuantity, invoiceLine, saveQuantities, seedInvoiceWorld, setDelivered } from "./invoice-helpers";
import { createOrder } from "./orders-helpers";

// US1 of Module 006: create the invoice draft from a confirmed order, check it, adjust the delivered (billed)
// quantity, see what blocks issuing, refresh a stale draft, discard it. Mobile project (360 px) only.
test.describe("US1: invoice draft", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("creates one draft from the order screen with prices from the order snapshot", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    await createDraftFromOrder(page, order.id);

    await expect(page.getByTestId("invoice-heading")).toHaveText("Draft invoice");
    await expect(page.getByTestId("invoice-status")).toHaveText("Draft");
    await expect(page.getByTestId("invoice-store")).toHaveText("Al Madina Medical");
    await expect(page.getByTestId("invoice-line")).toHaveCount(2);
    await expect(invoiceLine(page, 0)).toContainText("Panadol 500mg");
    await expect(invoiceLine(page, 0).getByTestId("invoice-line-ordered")).toContainText("Ordered: 10 strip");
    await expect(invoiceLine(page, 0).getByTestId("delivered-input")).toHaveValue("10");
    await expect(invoiceLine(page, 0).getByTestId("invoice-line-price")).toContainText("PKR 125.50");
    await expect(invoiceLine(page, 0).getByTestId("invoice-line-total")).toHaveText("PKR 1,255.00");
    await expect(invoiceLine(page, 1).getByTestId("invoice-line-total")).toHaveText("PKR 1,550.00");
    await expect(page.getByTestId("invoice-grand-total")).toHaveText("PKR 2,805.00");

    // A later change of the catalog price never changes the draft.
    const changed = await freshTenant.client.from("products").update({ selling_price: "999.00" }).eq("id", seed.pricedId);
    expect(changed.error).toBeNull();
    await page.reload();
    await expect(invoiceLine(page, 0).getByTestId("invoice-line-price")).toContainText("PKR 125.50");
    await expect(page.getByTestId("invoice-grand-total")).toHaveText("PKR 2,805.00");
  });

  test("shows the draft instead of a second Create button, and a second request makes no second draft", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    const invoiceId = await createDraftFromOrder(page, order.id);

    await page.goto(`/orders/${order.id}`);
    await expect(page.getByTestId("create-invoice")).toHaveCount(0);
    await expect(page.getByTestId("view-invoice-label")).toHaveText("Open draft invoice");

    // Another tap or another device sends a different request id for the same order: the existing draft comes back.
    const res = await page.request.post("/api/invoices", { data: { id: crypto.randomUUID(), order_id: order.id } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ done: true, created: false, existing: true });
    expect(body.invoice.id).toBe(invoiceId);
    const list = await (await page.request.get(`/api/invoices?order=${order.id}`)).json();
    expect(list.total).toBe(1);
  });

  test("changes a delivered quantity: only that line and the grand total change, the ordered quantity stays", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    await createDraftFromOrder(page, order.id);

    await setDelivered(page, 0, "8");
    await expect(page.getByTestId("totals-after-save")).toBeVisible();
    await saveQuantities(page);
    await expect(invoiceLine(page, 0).getByTestId("invoice-line-total")).toHaveText("PKR 1,004.00");
    await expect(invoiceLine(page, 1).getByTestId("invoice-line-total")).toHaveText("PKR 1,550.00");
    await expect(page.getByTestId("invoice-grand-total")).toHaveText("PKR 2,554.00");
    await expect(invoiceLine(page, 0).getByTestId("invoice-line-ordered")).toContainText("Ordered: 10 strip");

    // A line that was not delivered is not billed; more than ordered is allowed with a note.
    await setDelivered(page, 1, "0");
    await saveQuantities(page);
    await expect(invoiceLine(page, 1)).toContainText("Not delivered, not billed");
    await expect(invoiceLine(page, 1).getByTestId("invoice-line-total")).toHaveText("Not billed");
    await expect(page.getByTestId("invoice-grand-total")).toHaveText("PKR 1,004.00");
    await setDelivered(page, 0, "12");
    await saveQuantities(page);
    await expect(invoiceLine(page, 0)).toContainText("More than ordered");
    await expect(page.getByTestId("invoice-grand-total")).toHaveText("PKR 1,506.00");

    // The stepper buttons change the typed number by one, and a bad number cannot be saved.
    await invoiceLine(page, 0).getByRole("button", { name: /Increase delivered quantity/ }).click();
    await expect(invoiceLine(page, 0).getByTestId("delivered-input")).toHaveValue("13");
    await setDelivered(page, 0, "abc");
    await expect(invoiceLine(page, 0)).toContainText("Enter a whole number from 0 to 100,000.");
    await expect(page.getByTestId("save-quantities")).toBeDisabled();
  });

  test("shows the lines that block issuing and links to Pending", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed, [
      { product_id: seed.pricedId, quantity: 2, unit: "strip" },
      { product_id: null, name: "Noran 20mg cap", quantity: 3, unit: "strip" },
      { product_id: seed.noPriceId, quantity: 1, unit: "bottle" },
    ]);
    await signIn(page, freshTenant);
    await createDraftFromOrder(page, order.id);

    await expect(invoiceLine(page, 1)).toContainText("Not registered");
    await expect(invoiceLine(page, 1)).toContainText("Needs a verified selling price");
    await expect(invoiceLine(page, 1).getByTestId("invoice-line-price")).toContainText("—");
    await expect(page.getByTestId("invoice-blockers")).toContainText("Noran 20mg cap");
    await expect(page.getByTestId("invoice-blockers")).toContainText("Calpol Syrup");
    await expect(page.getByTestId("invoice-grand-total")).toHaveText("PKR 251.00");
    await expect(page.getByTestId("issue-invoice")).toBeDisabled();
    await expect(page.getByTestId("issue-blocked-reason")).toContainText("no verified selling price");

    await page.getByTestId("blockers-register-link").click();
    await expect(page).toHaveURL(/\/pending\?tab=register/);
  });

  test("warns when the order changed, blocks issuing, and rebuilds the draft with Refresh from order", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    await createDraftFromOrder(page, order.id);
    await expect(page.getByTestId("stale-notice")).toHaveCount(0);

    await editFirstLineQuantity(freshTenant, seed, order.id, 12);
    await page.reload();
    await expect(page.getByTestId("stale-notice")).toContainText("The order has changed");
    await expect(page.getByTestId("issue-invoice")).toBeDisabled();
    await page.getByTestId("refresh-from-order").click();
    await page.getByTestId("refresh-confirm").click();
    await expect(page.getByTestId("stale-notice")).toHaveCount(0);
    await expect(invoiceLine(page, 0).getByTestId("invoice-line-ordered")).toContainText("Ordered: 12 strip");
    await expect(invoiceLine(page, 0).getByTestId("delivered-input")).toHaveValue("12");
    await expect(page.getByTestId("invoice-grand-total")).toHaveText("PKR 3,056.00");
    await expect(page.getByTestId("issue-invoice")).toBeEnabled();
  });

  test("discards a draft and goes back to the order, which can get a new draft", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    await createDraftFromOrder(page, order.id);
    await page.getByTestId("discard-invoice").click();
    await page.getByTestId("discard-confirm").click();
    await page.waitForURL(new RegExp(`/orders/${order.id}$`));
    await expect(page.getByTestId("create-invoice")).toBeVisible();
  });

  test("offers an invoice action only for a confirmed order", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const draftOrder = await createOrder(freshTenant, seed.storeId, [{ product_id: seed.pricedId, quantity: 1, unit: "strip" }]);
    const cancelled = await confirmedOrder(freshTenant, seed);
    await cancelOrder(freshTenant, cancelled.id);
    const confirmed = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);

    await page.goto(`/orders/${draftOrder.id}`);
    await expect(page.getByTestId("order-line").first()).toBeVisible();
    await expect(page.getByTestId("create-invoice")).toHaveCount(0);
    await expect(page.getByTestId("view-invoice")).toHaveCount(0);

    await page.goto(`/orders/${cancelled.id}`);
    await expect(page.getByTestId("order-status")).toContainText("Cancelled");
    await expect(page.getByTestId("create-invoice")).toHaveCount(0);

    await page.goto(`/orders/${confirmed.id}`);
    await expect(page.getByTestId("create-invoice")).toBeVisible();
  });

  test("says so when the order of a draft was cancelled, and the draft can only be discarded", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    await createDraftFromOrder(page, order.id);
    await cancelOrder(freshTenant, order.id);
    await page.reload();
    await expect(page.getByTestId("order-not-confirmed")).toContainText("no longer confirmed");
    await expect(page.getByTestId("issue-invoice")).toBeDisabled();
    await page.getByTestId("discard-invoice").click();
    await page.getByTestId("discard-confirm").click();
    await page.waitForURL(new RegExp(`/orders/${order.id}$`));
    await expect(page.getByTestId("create-invoice")).toHaveCount(0);
  });

  test("shows a loading state, an error with Retry, and keeps typed quantities when a save fails", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    const invoiceId = await createDraftFromOrder(page, order.id);

    // A save that cannot reach the server keeps the typed number and shows the reason.
    await setDelivered(page, 0, "7");
    await page.route(`**/api/invoices/${invoiceId}`, (route) => (route.request().method() === "PATCH" ? route.abort() : route.continue()));
    await page.getByTestId("save-quantities").click();
    await expect(page.getByTestId("invoice-error")).toContainText("Can't reach the server");
    await expect(invoiceLine(page, 0).getByTestId("delivered-input")).toHaveValue("7");
    await page.unroute(`**/api/invoices/${invoiceId}`);

    // The invoice screen shows an error with Retry when the invoice cannot be read, then loads on retry.
    let fail = true;
    await page.route(`**/api/invoices/${invoiceId}`, (route) => {
      if (route.request().method() === "GET" && fail) return route.fulfill({ status: 500, json: { code: "server_error", message: "Something went wrong. Please try again." } });
      return route.continue();
    });
    await page.reload();
    await expect(page.getByTestId("error-state")).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("invoice-editor")).toBeVisible();
  });
});
