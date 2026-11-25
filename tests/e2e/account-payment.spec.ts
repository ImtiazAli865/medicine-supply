import { expect, signIn, test } from "./fixtures";
import { accountStore, addOpening, addPayment, issueFor, openAccount } from "./account-helpers";

// User Story 3 of Module 007: record a payment and see what it paid. Mobile project only.
test.describe("US3: record a payment", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("the preview shows the balance after and the items settled oldest first, then the payment is saved", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await addOpening(freshTenant, store.id, "1000.00", "owes", "2026-10-01");
    await issueFor(freshTenant, store.id, "500.00");
    await signIn(page, freshTenant);
    await openAccount(page, store.id);
    await expect(page.getByTestId("account-balance")).toHaveText("Owes PKR 1,500.00");

    await page.getByTestId("open-payment").click();
    await page.getByTestId("payment-amount").fill("1200");
    await expect(page.getByTestId("preview-after")).toContainText("Owes PKR 300.00");
    const settles = page.getByTestId("preview-settle");
    await expect(settles).toHaveCount(2);
    await expect(settles.first()).toContainText("Opening balance");
    await page.getByTestId("payment-reference").fill("Receipt 42");
    await page.getByTestId("payment-save").click();
    await expect(page.getByTestId("account-notice")).toHaveText("Payment saved.");
    await expect(page.getByTestId("account-balance")).toHaveText("Owes PKR 300.00");
    await expect(page.getByTestId("entry-row").first()).toContainText("Payment");
    await expect(page.getByTestId("entry-row").first()).toContainText("Receipt 42");
  });

  test("a payment above the balance is kept as an advance and the preview says so", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await addOpening(freshTenant, store.id, "400.00");
    await signIn(page, freshTenant);
    await openAccount(page, store.id);
    await page.getByTestId("open-payment").click();
    await page.getByTestId("payment-amount").fill("1000");
    await expect(page.getByTestId("preview-advance")).toContainText("PKR 600.00");
    await page.getByTestId("payment-save").click();
    await expect(page.getByTestId("account-balance")).toHaveText("Advance PKR 600.00");
    await expect(page.getByTestId("account-balance-sentence")).toContainText("paid PKR 600.00 in advance");
  });

  test("shows an error for an invalid amount or a future date and keeps the form", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await signIn(page, freshTenant);
    await openAccount(page, store.id);
    await page.getByTestId("open-payment").click();
    await page.getByTestId("payment-amount").fill("0");
    await page.getByTestId("payment-save").click();
    await expect(page.getByRole("dialog")).toContainText("Enter an amount above 0 with at most two decimals.");
    await page.getByTestId("payment-amount").fill("50");
    // A future date is stopped by the date field itself (its latest date is today); the server also refuses it
    // (tested in accounts-api and the PGlite suites).
    await page.getByTestId("payment-date").fill("2999-01-01");
    expect(await page.getByTestId("payment-date").evaluate((el) => (el as HTMLInputElement).validity.rangeOverflow)).toBe(true);
    await page.getByTestId("payment-save").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByTestId("account-notice")).toHaveCount(0);
    await expect(page.getByTestId("payment-amount")).toHaveValue("50");
  });

  test("records one payment when Save is tapped twice quickly and after a reload", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await signIn(page, freshTenant);
    await openAccount(page, store.id);
    await page.getByTestId("open-payment").click();
    await page.getByTestId("payment-amount").fill("75");
    await page.getByTestId("payment-save").dblclick();
    await expect(page.getByTestId("account-notice")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByTestId("entry-row")).toHaveCount(1);
    await expect(page.getByTestId("account-balance")).toHaveText("Advance PKR 75.00");
  });

  test("a failed save shows an error, keeps the form and is saved once on retry", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await signIn(page, freshTenant);
    await openAccount(page, store.id);
    let fail = true;
    await page.route("**/api/accounts/*/payments", (route) =>
      fail ? route.fulfill({ status: 500, json: { code: "server_error", message: "Something went wrong. Please try again." } }) : route.continue(),
    );
    await page.getByTestId("open-payment").click();
    await page.getByTestId("payment-amount").fill("120");
    await page.getByTestId("payment-save").click();
    await expect(page.getByRole("dialog")).toContainText("Something went wrong. Please try again.");
    await expect(page.getByTestId("payment-amount")).toHaveValue("120");
    await expect(page.locator("body")).not.toContainText(/saved on this device|pending sync/i);
    fail = false;
    await page.getByTestId("payment-save").click();
    await expect(page.getByTestId("entry-row")).toHaveCount(1);
  });

  test("a server error offers no way to keep the payment on the phone, but a lost connection does, and it is recorded once", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await addOpening(freshTenant, store.id, "1000.00", "owes");
    await signIn(page, freshTenant);
    await openAccount(page, store.id);
    let mode: "server_error" | "lost" | "ok" = "server_error";
    await page.route("**/api/accounts/*/payments", (route) => {
      if (mode === "server_error") return route.fulfill({ status: 500, json: { code: "server_error", message: "Something went wrong. Please try again." } });
      if (mode === "lost") return route.abort("connectionreset");
      return route.continue();
    });
    await page.getByTestId("open-payment").click();
    await page.getByTestId("payment-amount").fill("400");
    await page.getByTestId("payment-save").click();
    await expect(page.getByRole("dialog")).toContainText("Something went wrong. Please try again.");
    await expect(page.getByTestId("payment-keep-on-phone")).toHaveCount(0);

    // The connection is lost: the payment can be kept on the phone, with the same key the form holds
    mode = "lost";
    await page.getByTestId("payment-save").click();
    await expect(page.getByRole("dialog")).toContainText("Can't reach the server");
    await page.getByTestId("payment-keep-on-phone").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("account-notice")).toHaveText("Saved on this phone. It is not in the store's account until it is sent.");
    await expect(page.getByTestId("balance-pending-sync")).toHaveText("Pending sync");
    await expect(page.getByTestId("pending-sync-text")).toHaveText("1 payment waiting on this phone, PKR 400.00, not counted yet");
    await expect(page.getByTestId("account-balance")).toHaveText("Owes PKR 1,000.00");
    await expect(page.getByTestId("entry-row")).toHaveCount(1); // only the opening balance

    // The server can be reached again: the payment is sent, recorded once, and the screen reads the new balance
    mode = "ok";
    await expect(page.getByTestId("pending-sync-note")).toHaveCount(0, { timeout: 90_000 });
    await expect(page.getByTestId("account-balance")).toHaveText("Owes PKR 600.00", { timeout: 30_000 });
    await expect(page.getByTestId("entry-row").filter({ hasText: "Payment" })).toHaveCount(1);
  });

  test("the account lists what is still unpaid and its status moves to paid after the payment", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await issueFor(freshTenant, store.id, "800.00");
    await addPayment(freshTenant, store.id, "300.00");
    await signIn(page, freshTenant);
    await openAccount(page, store.id);
    await expect(page.getByTestId("open-item")).toHaveCount(1);
    await expect(page.getByTestId("open-item")).toContainText("Partly paid");
    await expect(page.getByTestId("open-item")).toContainText("PKR 500.00");
    await page.getByTestId("open-payment").click();
    await page.getByTestId("payment-amount").fill("500");
    await page.getByTestId("payment-save").click();
    await expect(page.getByTestId("account-balance")).toHaveText("Settled");
    await expect(page.getByTestId("open-item")).toHaveCount(0);
  });
});
