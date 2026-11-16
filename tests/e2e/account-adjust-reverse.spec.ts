import { expect, signIn, test } from "./fixtures";
import { accountStore, addAdjustment, addOpening, addPayment, issueFor, openAccount } from "./account-helpers";

// User Story 6 of Module 007: write off or add a small amount, and correct mistakes by reversal. Mobile project only.
test.describe("US6: adjustments and reversals", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("a small amount is written off with a reason, which shows in the history", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await addOpening(freshTenant, store.id, "1000.00");
    await signIn(page, freshTenant);
    await openAccount(page, store.id);
    await page.getByTestId("open-adjustment").click();
    await page.getByTestId("adjustment-amount").fill("30");
    // An empty reason is stopped by the field itself (it is required); nothing is saved.
    await page.getByTestId("adjustment-save").click();
    expect(await page.getByTestId("adjustment-reason").evaluate((el) => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByTestId("account-notice")).toHaveCount(0);
    await page.getByTestId("adjustment-reason").fill("Rounding forgiven");
    await page.getByTestId("adjustment-save").click();
    await expect(page.getByTestId("account-notice")).toHaveText("Adjustment saved.");
    await expect(page.getByTestId("account-balance")).toHaveText("Owes PKR 970.00");
    await expect(page.getByTestId("entry-row").first()).toContainText("Reason: Rounding forgiven");
  });

  test("an amount can be added in the other direction", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await signIn(page, freshTenant);
    await openAccount(page, store.id);
    await page.getByTestId("open-adjustment").click();
    await page.getByTestId("adjustment-direction").selectOption("increase");
    await page.getByTestId("adjustment-amount").fill("45.50");
    await page.getByTestId("adjustment-reason").fill("Delivery charge");
    await page.getByTestId("adjustment-save").click();
    await expect(page.getByTestId("account-balance")).toHaveText("Owes PKR 45.50");
  });

  test("a payment is reversed with a reason: it stays in the history as reversed and the balance goes back", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await addOpening(freshTenant, store.id, "700.00");
    await addPayment(freshTenant, store.id, "200.00");
    await signIn(page, freshTenant);
    await openAccount(page, store.id);
    await expect(page.getByTestId("account-balance")).toHaveText("Owes PKR 500.00");
    const payment = page.locator('[data-testid="entry-row"][data-entry-type="payment"]');
    await payment.getByTestId("entry-reverse").click();
    // An empty reason is stopped by the field itself (it is required); nothing is saved.
    await page.getByTestId("reverse-save").click();
    expect(await page.getByTestId("reverse-reason").evaluate((el) => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByTestId("account-notice")).toHaveCount(0);
    await page.getByTestId("reverse-reason").fill("Entered in the wrong store");
    await page.getByTestId("reverse-save").click();
    await expect(page.getByTestId("account-notice")).toHaveText("Entry reversed.");
    await expect(page.getByTestId("account-balance")).toHaveText("Owes PKR 700.00");
    await expect(payment).toHaveAttribute("data-reversed", "true");
    await expect(payment.getByTestId("entry-reverse")).toHaveCount(0);
    await expect(page.locator('[data-testid="entry-row"][data-entry-type="reversal"]')).toContainText("Reason: Entered in the wrong store");
  });

  test("an invoice entry and a reversal have no Reverse button", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await issueFor(freshTenant, store.id, "250.00");
    const adjustment = await addAdjustment(freshTenant, store.id, "10.00", "reduce", "Small discount");
    expect(adjustment).toBeTruthy();
    await signIn(page, freshTenant);
    await openAccount(page, store.id);
    await expect(page.locator('[data-testid="entry-row"][data-entry-type="invoice"]').getByTestId("entry-reverse")).toHaveCount(0);
    await page.locator('[data-testid="entry-row"][data-entry-type="adjustment"]').getByTestId("entry-reverse").click();
    await page.getByTestId("reverse-reason").fill("Mistake");
    await page.getByTestId("reverse-save").click();
    await expect(page.getByTestId("account-notice")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="entry-row"][data-entry-type="reversal"]').getByTestId("entry-reverse")).toHaveCount(0);
  });

  test("reversing records one entry when Save is tapped twice quickly", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await addPayment(freshTenant, store.id, "60.00");
    await signIn(page, freshTenant);
    await openAccount(page, store.id);
    await page.getByTestId("entry-reverse").click();
    await page.getByTestId("reverse-reason").fill("Wrong amount");
    await page.getByTestId("reverse-save").dblclick();
    await expect(page.getByTestId("account-notice")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.locator('[data-testid="entry-row"][data-entry-type="reversal"]')).toHaveCount(1);
  });
});
