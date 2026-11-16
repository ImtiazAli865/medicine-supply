import { expect, signIn, test } from "./fixtures";
import { confirmedOrder, createDraftFromOrder, issueDraft, seedInvoiceWorld } from "./invoice-helpers";
import { balanceOfStore, openAccount } from "./account-helpers";

// User Story 2 of Module 007: an issued invoice enters the store account, a cancelled one leaves it by a reversal.
test.describe("US2: invoices and the store account", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("issuing adds one invoice entry and cancelling adds one reversal; both stay visible", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    await createDraftFromOrder(page, order.id);
    // a draft is not in the account
    expect(await balanceOfStore(freshTenant, seed.storeId)).toBe("0.00");

    const number = await issueDraft(page);
    await expect(page.getByTestId("invoice-payment-status")).toContainText("Unpaid");
    await expect(page.getByTestId("invoice-amount-outstanding")).toHaveText("PKR 2,805.00");
    expect(await balanceOfStore(freshTenant, seed.storeId)).toBe("2805.00");

    await page.getByTestId("invoice-account-link").click();
    await expect(page.getByTestId("account-balance")).toHaveText("Owes PKR 2,805.00");
    await expect(page.getByTestId("entry-row")).toHaveCount(1);
    await expect(page.getByTestId("entry-row").first()).toContainText(number);
    await expect(page.getByTestId("entry-row").first().getByTestId("entry-reverse")).toHaveCount(0);

    // cancel the invoice from its own screen
    await page.getByTestId("entry-row").first().getByRole("link", { name: number }).click();
    await page.getByTestId("cancel-invoice").click();
    await expect(page.getByTestId("cancel-account-note")).toContainText("reversal entry");
    await page.getByTestId("cancel-invoice-reason").fill("Wrong quantity delivered");
    await page.getByTestId("cancel-invoice-confirm").click();
    await expect(page.getByTestId("invoice-status")).toHaveText("Cancelled");
    expect(await balanceOfStore(freshTenant, seed.storeId)).toBe("0.00");

    await openAccount(page, seed.storeId);
    await expect(page.getByTestId("account-balance")).toHaveText("Settled");
    await expect(page.getByTestId("entry-row")).toHaveCount(2);
    await expect(page.locator('[data-testid="entry-row"][data-entry-type="reversal"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="entry-row"][data-entry-type="invoice"]')).toHaveAttribute("data-reversed", "true");
  });
});
