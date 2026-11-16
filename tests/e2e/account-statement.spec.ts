import { expect, signIn, test } from "./fixtures";
import { TODAY, accountStore, addAdjustment, addOpening, addPayment, issueFor } from "./account-helpers";

// User Story 7 of Module 007: the Store Statement for a date range. Mobile project only.
test.describe("US7: store statement", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("lists the entries of a range with the opening, totals and closing balance, and prints", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant, "Nimer Statement Store");
    await addOpening(freshTenant, store.id, "1000.00", "owes", "2026-10-01");
    await addPayment(freshTenant, store.id, "400.00", "2026-10-20", "Receipt 7");
    await issueFor(freshTenant, store.id, "250.00");
    await addAdjustment(freshTenant, store.id, "50.00", "reduce", "Rounding");
    await signIn(page, freshTenant);
    await page.goto(`/accounts/${store.id}/statement?from=2026-10-15&to=${TODAY}`);

    await expect(page.getByTestId("statement-store")).toHaveText("Nimer Statement Store");
    await expect(page.getByTestId("statement-range")).toContainText(`2026-10-15 to ${TODAY}`);
    await expect(page.getByTestId("statement-opening")).toContainText("Owes PKR 1,000.00");
    await expect(page.getByTestId("statement-row")).toHaveCount(3);
    await expect(page.getByTestId("statement-total-debit")).toHaveText("PKR 250.00");
    await expect(page.getByTestId("statement-total-credit")).toHaveText("PKR 450.00");
    await expect(page.getByTestId("statement-closing")).toHaveText("Owes PKR 800.00");
    await expect(page.getByTestId("statement")).toContainText("Reason: Rounding");
    await expect(page.getByTestId("print-now")).toBeVisible();

    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("statement-toolbar")).toBeHidden();
    await expect(page.getByTestId("statement")).toBeVisible();
    const pdf = await page.pdf({ format: "A4" });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1500);
  });

  test("changing the dates changes the address and the statement", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await addOpening(freshTenant, store.id, "100.00", "owes", "2026-10-01");
    await signIn(page, freshTenant);
    await page.goto(`/accounts/${store.id}/statement?from=2026-10-01&to=${TODAY}`);
    await expect(page.getByTestId("statement-row")).toHaveCount(1);
    await page.getByTestId("statement-from").fill("2026-10-02");
    await expect(page).toHaveURL(/from=2026-10-02/);
    await expect(page.getByTestId("statement-empty")).toBeVisible();
    await expect(page.getByTestId("statement-opening")).toContainText("Owes PKR 100.00");
    await expect(page.getByTestId("statement-closing")).toHaveText("Owes PKR 100.00");
  });

  test("a start date after the end date shows a message and no statement", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await signIn(page, freshTenant);
    await page.goto(`/accounts/${store.id}/statement?from=2026-11-10&to=2026-11-01`);
    await expect(page.getByTestId("statement-invalid")).toContainText("The start date must not be after the end date.");
    await expect(page.getByTestId("statement")).toHaveCount(0);
  });

  test("an unknown store shows the not found page", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto(`/accounts/00000000-0000-4000-8000-000000000000/statement`);
    await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
    await expect(page.getByTestId("statement")).toHaveCount(0);
  });

  test("the account links to the statement and the statement has no cost or profit wording", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await addOpening(freshTenant, store.id, "100.00");
    await signIn(page, freshTenant);
    await page.goto(`/accounts/${store.id}`);
    await page.getByTestId("open-statement").click();
    await expect(page).toHaveURL(/\/statement/);
    await expect(page.getByTestId("statement")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/purchase price|mrp|margin|profit|cost/i);
  });
});
