import { expect, signIn, test } from "./fixtures";
import { accountStore, addPayment, issueFor } from "./account-helpers";

// User Story 3 of Module 007: the Invoices list shows the derived paid status. Mobile project only.
test.describe("US3: paid status on the Invoices list", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("a payment settles the oldest invoice first: Paid, Partly paid, Unpaid", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await issueFor(freshTenant, store.id, "100.00");
    await issueFor(freshTenant, store.id, "200.00");
    await issueFor(freshTenant, store.id, "300.00");
    await addPayment(freshTenant, store.id, "150.00");
    await signIn(page, freshTenant);
    await page.goto("/invoices");
    const items = page.getByTestId("invoice-item");
    await expect(items).toHaveCount(3);
    // newest first: INV-000003 (300, unpaid), INV-000002 (200, partly paid), INV-000001 (100, paid)
    await expect(items.nth(0).getByTestId("invoice-item-payment")).toHaveAttribute("data-payment-status", "unpaid");
    await expect(items.nth(1).getByTestId("invoice-item-payment")).toHaveAttribute("data-payment-status", "partially_paid");
    await expect(items.nth(2).getByTestId("invoice-item-payment")).toHaveAttribute("data-payment-status", "paid");
    await expect(items.nth(1)).toContainText("Partly paid");
  });

  test("the status moves to Paid when the rest is paid and back when the payment is reversed", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    const invoice = await issueFor(freshTenant, store.id, "400.00");
    await addPayment(freshTenant, store.id, "400.00");
    await signIn(page, freshTenant);
    await page.goto(`/invoices/${invoice.invoiceId}`);
    await expect(page.getByTestId("invoice-payment-status")).toContainText("Paid");
    await expect(page.getByTestId("invoice-amount-outstanding")).toHaveText("PKR 0.00");

    await page.getByTestId("invoice-account-link").click();
    await page.locator('[data-testid="entry-row"][data-entry-type="payment"]').getByTestId("entry-reverse").click();
    await page.getByTestId("reverse-reason").fill("Cheque bounced");
    await page.getByTestId("reverse-save").click();
    await expect(page.getByTestId("account-notice")).toHaveText("Entry reversed.");

    await page.goto(`/invoices/${invoice.invoiceId}`);
    await expect(page.getByTestId("invoice-payment-status")).toContainText("Unpaid");
    await expect(page.getByTestId("invoice-amount-outstanding")).toHaveText("PKR 400.00");
  });

  test("the paid status filter lists only invoices with that status", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await issueFor(freshTenant, store.id, "100.00");
    await issueFor(freshTenant, store.id, "200.00");
    await addPayment(freshTenant, store.id, "100.00");
    await signIn(page, freshTenant);
    await page.goto("/invoices");
    await expect(page.getByTestId("invoice-item")).toHaveCount(2);
    const res = await page.request.get("/api/invoices?payment_status=unpaid&limit=20");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { items: Array<{ payment_status: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].payment_status).toBe("unpaid");
  });
});
