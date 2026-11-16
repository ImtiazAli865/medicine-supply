import { expect, signIn, test } from "./fixtures";
import { confirmedOrder, createDraftFromOrder, seedInvoiceWorld } from "./invoice-helpers";
import { balanceOfStore } from "./account-helpers";

// User Story 4 of Module 007: take payment at delivery while issuing the invoice (one step). Mobile project only.
test.describe("US4: payment received while issuing", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("a partial payment at issue leaves the invoice partly paid", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    await createDraftFromOrder(page, order.id);
    await page.getByTestId("issue-invoice").click();
    await page.getByTestId("issue-payment").fill("1000");
    await page.getByTestId("issue-confirm").click();
    await expect(page.getByTestId("invoice-view")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("invoice-payment-status")).toContainText("Partly paid");
    await expect(page.getByTestId("invoice-amount-paid")).toHaveText("PKR 1,000.00");
    await expect(page.getByTestId("invoice-amount-outstanding")).toHaveText("PKR 1,805.00");
    expect(await balanceOfStore(freshTenant, seed.storeId)).toBe("1805.00");
  });

  test("a payment above the total shows the advance note and leaves an advance", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    await createDraftFromOrder(page, order.id);
    await page.getByTestId("issue-invoice").click();
    await page.getByTestId("issue-payment").fill("3000");
    await expect(page.getByTestId("issue-payment-advance")).toContainText("PKR 195.00");
    await page.getByTestId("issue-confirm").click();
    await expect(page.getByTestId("invoice-view")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("invoice-payment-status")).toContainText("Paid");
    expect(await balanceOfStore(freshTenant, seed.storeId)).toBe("-195.00");
  });

  test("an invalid payment is refused, keeps the dialog open and does not issue the invoice", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    await createDraftFromOrder(page, order.id);
    await page.getByTestId("issue-invoice").click();
    await page.getByTestId("issue-payment").fill("12.345");
    await page.getByTestId("issue-confirm").click();
    await expect(page.getByRole("dialog")).toContainText("Enter an amount");
    await expect(page.getByTestId("invoice-view")).toHaveCount(0);
    expect(await balanceOfStore(freshTenant, seed.storeId)).toBe("0.00");
  });

  test("issuing with no payment still works and records no payment", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    await createDraftFromOrder(page, order.id);
    await page.getByTestId("issue-invoice").click();
    await page.getByTestId("issue-confirm").click();
    await expect(page.getByTestId("invoice-view")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("invoice-payment-status")).toContainText("Unpaid");
  });
});
