import { expect, signIn, test } from "./fixtures";
import { confirmedOrder, createDraftFromOrder, issueDraft, orderRow, seedInvoiceWorld } from "./invoice-helpers";

// US4 of Module 006: cancel a wrong invoice with a reason and replace it. Mobile project (360 px) only.
test.describe("US4: cancel and replace", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("requires a reason, keeps the invoice with its number, returns the order to Confirmed and allows a replacement", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    await createDraftFromOrder(page, order.id);
    const number = await issueDraft(page);
    expect(number).toBe("INV-000001");

    await page.getByTestId("cancel-invoice").click();
    await expect(page.getByRole("dialog")).toContainText("Cancel INV-000001?");
    await page.getByTestId("cancel-invoice-confirm").click();
    await expect(page.getByRole("dialog")).toContainText("Write why this invoice is cancelled.");
    expect((await orderRow(freshTenant, order.id)).status).toBe("fulfilled");

    await page.getByTestId("cancel-invoice-reason").fill("Wrong quantity delivered");
    await page.getByTestId("cancel-invoice-confirm").click();
    await expect(page.getByTestId("invoice-cancelled")).toContainText("Wrong quantity delivered");
    await expect(page.getByTestId("invoice-status")).toHaveText("Cancelled");
    await expect(page.getByTestId("invoice-heading")).toHaveText("INV-000001");
    await expect(page.getByTestId("invoice-line")).toHaveCount(2);
    await expect(page.getByTestId("invoice-grand-total")).toHaveText("PKR 2,805.00");
    await expect(page.getByTestId("cancel-invoice")).toHaveCount(0);
    await expect(page.getByTestId("print-a4")).toBeVisible();
    await expect(page.getByTestId("invoice-history-event").first()).toContainText("INV-000001 cancelled");
    expect((await orderRow(freshTenant, order.id)).status).toBe("confirmed");

    // The order is Confirmed again, lists the cancelled invoice, and offers a new one.
    await page.getByTestId("back-to-order").click();
    await expect(page.getByTestId("order-status")).toContainText("Confirmed");
    await expect(page.getByTestId("earlier-invoice")).toContainText("INV-000001 · Cancelled");
    await expect(page.getByTestId("order-history-log")).toContainText("Invoice INV-000001 cancelled");
    await page.getByTestId("create-invoice").click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
    expect(await issueDraft(page)).toBe("INV-000002");
  });

  test("a repeated cancel keeps one cancellation and the first reason", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    const invoiceId = await createDraftFromOrder(page, order.id);
    await issueDraft(page);
    const first = await page.request.post(`/api/invoices/${invoiceId}/cancel`, { data: { reason: "First reason" } });
    const again = await page.request.post(`/api/invoices/${invoiceId}/cancel`, { data: { reason: "Second reason" } });
    expect(first.status()).toBe(200);
    expect(again.status()).toBe(200);
    const body = await again.json();
    expect(body).toMatchObject({ done: true, replayed: true });
    expect(body.invoice.cancel_reason).toBe("First reason");
    const empty = await page.request.post(`/api/invoices/${invoiceId}/cancel`, { data: { reason: "   " } });
    expect(empty.status()).toBe(400);
    expect((await empty.json()).code).toBe("validation_error");
  });

  test("a draft has no cancel button and an issued invoice has no discard button", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    await createDraftFromOrder(page, order.id);
    await expect(page.getByTestId("cancel-invoice")).toHaveCount(0);
    await expect(page.getByTestId("discard-invoice")).toBeVisible();
    await issueDraft(page);
    await expect(page.getByTestId("discard-invoice")).toHaveCount(0);
    await expect(page.getByTestId("cancel-invoice")).toBeVisible();
  });
});
