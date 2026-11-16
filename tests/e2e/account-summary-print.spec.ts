import { expect, signIn, test } from "./fixtures";
import { accountStore, addOpening, cancelIssued, issueFor } from "./account-helpers";

// User Story 5 of Module 007: the Account Summary on the invoice printout. Mobile project only; print media and a
// generated PDF are checked, a real printer is not claimed.
test.describe("US5: Account Summary on the printed invoice", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("shows the five figures when chosen, hides them by default, and prints to a real PDF", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await addOpening(freshTenant, store.id, "1000.00", "owes", "2026-10-01");
    const invoice = await issueFor(freshTenant, store.id, "800.00", "500.00");
    await signIn(page, freshTenant);

    // default: the Settings default is off, so no summary
    await page.goto(`/invoices/${invoice.invoiceId}/print`);
    await expect(page.getByTestId("invoice-print")).toBeVisible();
    await expect(page.getByTestId("account-summary")).toHaveCount(0);
    await expect(page.getByTestId("summary-toggle")).toHaveAttribute("aria-checked", "false");

    // choose it: the address carries the choice and the block appears under the grand total
    await page.getByTestId("summary-toggle").click();
    await expect(page).toHaveURL(/summary=1/);
    const block = page.getByTestId("account-summary");
    await expect(block).toBeVisible();
    await expect(page.getByTestId("summary-previous")).toContainText("1,000.00");
    await expect(page.getByTestId("summary-invoice")).toHaveText("PKR 800.00");
    await expect(page.getByTestId("summary-payment")).toHaveText("PKR 500.00");
    await expect(page.getByTestId("summary-due")).toContainText("1,300.00");
    await expect(block).not.toContainText(/purchase|mrp|cost|margin|profit/i);

    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("print-toolbar")).toBeHidden();
    await expect(block).toBeVisible();
    const pdf = await page.pdf({ format: "A4" });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1500);
  });

  test("shows the same five figures on the thermal layout without sideways scroll", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await addOpening(freshTenant, store.id, "250.00", "advance", "2026-10-01");
    const invoice = await issueFor(freshTenant, store.id, "100.00", "40.00");
    await signIn(page, freshTenant);
    await page.goto(`/invoices/${invoice.invoiceId}/print?layout=thermal&summary=1`);
    await expect(page.getByTestId("invoice-print")).toHaveAttribute("data-layout", "thermal");
    await expect(page.getByTestId("account-summary")).toBeVisible();
    // an advance of 250.00 before the invoice: previous is shown as an advance, 100 invoice, 40 paid, 140 of the advance left
    await expect(page.getByTestId("summary-previous")).toContainText("250.00");
    await expect(page.getByTestId("summary-invoice")).toHaveText("PKR 100.00");
    await expect(page.getByTestId("summary-payment")).toHaveText("PKR 40.00");
    await expect(page.getByTestId("summary-due")).toContainText("190.00");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  });

  test("the saved figures never change when a later entry is added", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    const invoice = await issueFor(freshTenant, store.id, "300.00");
    await addOpening(freshTenant, store.id, "5000.00", "owes", "2026-11-01");
    await signIn(page, freshTenant);
    await page.goto(`/invoices/${invoice.invoiceId}/print?summary=1`);
    await expect(page.getByTestId("summary-previous")).toContainText("0.00");
    await expect(page.getByTestId("summary-invoice")).toHaveText("PKR 300.00");
    await expect(page.getByTestId("summary-due")).toContainText("300.00");
    await expect(page.getByTestId("summary-payment")).toHaveCount(0);
  });

  test("a cancelled invoice prints without an Account Summary and the toolbar says why", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    const invoice = await issueFor(freshTenant, store.id, "250.00");
    await cancelIssued(freshTenant, invoice.invoiceId);
    await signIn(page, freshTenant);
    await page.goto(`/invoices/${invoice.invoiceId}/print?summary=1`);
    await expect(page.getByTestId("invoice-print")).toBeVisible();
    await expect(page.getByTestId("account-summary")).toHaveCount(0);
    await expect(page.getByTestId("print-toolbar")).toContainText("cancelled invoice is printed without an Account Summary");
  });
});
