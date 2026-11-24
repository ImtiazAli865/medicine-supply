import { addOpening, addPayment, accountStore } from "./account-helpers";
import { expect, signIn, test } from "./fixtures";
import { seedReportWorld } from "./reports-helpers";

// US4 of Module 010: Outstanding balances come from the same ledger functions as Home and Store accounts, so the total can
// never disagree with Home.
test.describe("US4: outstanding balances", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("shows what each store owes, an advance as an advance, and the same total as Home", async ({ page, freshTenant }) => {
    await seedReportWorld(freshTenant); // Al Madina Medical owes 2,805.00 (the cancelled invoice was reversed, the draft has no entry)
    const advance = await accountStore(freshTenant, "Advance Pharmacy");
    await addOpening(freshTenant, advance.id, "1000.00", "advance");
    const settled = await accountStore(freshTenant, "Settled Pharmacy");
    void settled;
    await signIn(page, freshTenant);

    await page.goto("/");
    const homeText = await page.getByTestId("accounts-summary-text").innerText();
    expect(homeText).toContain("PKR 2,805.00");

    await page.goto("/reports/balances");
    await expect(page.getByTestId("balances-total-owed")).toHaveText("PKR 2,805.00");
    await expect(page.getByTestId("balances-total")).toContainText("1 store has paid PKR 1,000.00 in advance; advances are not taken off this total");
    const items = page.getByTestId("account-item");
    await expect(items).toHaveCount(3);
    await expect(items.first()).toContainText("Al Madina Medical"); // the store that owes comes first
    await expect(items.first().getByTestId("account-item-balance")).toHaveAttribute("data-balance-kind", "owes");
    await expect(items.filter({ hasText: "Advance Pharmacy" }).getByTestId("account-item-balance")).toHaveAttribute("data-balance-kind", "advance");
    await expect(page.getByTestId("balances-not-in-account")).toHaveCount(0); // every invoice here is in an account
  });

  test("a payment for one store changes only that store's line and the total", async ({ page, freshTenant }) => {
    const world = await seedReportWorld(freshTenant);
    const other = await accountStore(freshTenant, "Other Pharmacy");
    await addOpening(freshTenant, other.id, "500.00", "owes");
    await signIn(page, freshTenant);
    await page.goto("/reports/balances");
    await expect(page.getByTestId("balances-total-owed")).toHaveText("PKR 3,305.00");

    await addPayment(freshTenant, world.storeId, "1000.00");
    await page.reload();
    await expect(page.getByTestId("balances-total-owed")).toHaveText("PKR 2,305.00");
    const items = page.getByTestId("account-item");
    await expect(items.filter({ hasText: "Other Pharmacy" })).toContainText("PKR 500.00");
    await expect(items.filter({ hasText: "Al Madina Medical" })).toContainText("PKR 1,805.00");
  });
});
