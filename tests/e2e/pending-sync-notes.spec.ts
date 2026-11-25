import { goOffline, goOnline, idbCount, waitDeviceReady } from "../helpers/offline";
import { accountStore, addOpening, balanceOfStore, issueFor, openAccount } from "./account-helpers";
import { expect, signIn, test } from "./fixtures";
import { openPaymentScreen, paymentsOnServer, savePhonePayment } from "./payment-helpers";

// Module 011, US2 (Principle III): while a payment waits on the phone, every balance shown on screen is marked "pending sync" and
// says what is not counted yet; the notes never reach an invoice print or the store statement; when the payment is confirmed the
// notes go and the balance is read again without a reload (mobile, 360 px).
test.describe("US2: balances shown while a payment waits on the phone", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(240_000);

  test("every balance screen says what is not counted yet, the prints do not, and the notes go when the payment is confirmed", async ({ page, context, freshTenant }) => {
    const a = await accountStore(freshTenant, "Alpha Pending");
    const b = await accountStore(freshTenant, "Beta Pending");
    await addOpening(freshTenant, a.id, "8000.00", "owes");
    await addOpening(freshTenant, b.id, "1000.00", "owes");
    const invoice = await issueFor(freshTenant, a.id, "100.00");

    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await openPaymentScreen(page);
    await savePhonePayment(page, { store: "Alpha Pending", amount: "5000", reference: "R9" });

    // Back online, but the server cannot be reached for payments, so the payment keeps waiting while the balances are shown.
    let blocked = true;
    await context.route(/\/api\/accounts\/[0-9a-f-]{36}\/payments$/, (route) => (blocked ? route.abort("connectionreset") : route.continue()));
    await goOnline(context);
    await openAccount(page, a.id);

    // The store's account screen
    await expect(page.getByTestId("account-balance")).toHaveText("Owes PKR 8,100.00");
    await expect(page.getByTestId("balance-pending-sync")).toHaveText("Pending sync");
    await expect(page.getByTestId("pending-sync-text")).toHaveText("1 payment waiting on this phone, PKR 5,000.00, not counted yet");
    const row = page.getByTestId("pending-payment-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("PKR 5,000.00");
    await expect(row).toContainText("Waiting");

    // The Store accounts list: the row of that store, not the other store's
    await page.goto("/accounts");
    const rowA = page.getByTestId("account-item").filter({ hasText: "Alpha Pending" });
    const rowB = page.getByTestId("account-item").filter({ hasText: "Beta Pending" });
    await expect(rowA.getByTestId("account-item-pending")).toHaveText("1 payment waiting, not counted yet");
    await expect(rowA.getByTestId("account-item-pending-badge")).toHaveText("Pending sync");
    await expect(rowB.getByTestId("account-item-pending")).toHaveCount(0);
    await expect(rowB.getByTestId("account-item-pending-badge")).toHaveCount(0);

    // Home: the total says it leaves the payment out
    await page.goto("/");
    await expect(page.getByTestId("accounts-pending-note")).toContainText("leaves out 1 payment waiting on this phone (PKR 5,000.00, not counted yet)");

    // Reports: the balances screen
    await page.goto("/reports/balances");
    await expect(page.getByTestId("accounts-pending-note")).toContainText("leaves out 1 payment waiting on this phone");
    await expect(page.getByTestId("account-item").filter({ hasText: "Alpha Pending" }).getByTestId("account-item-pending")).toBeVisible();
    await expect(page.getByTestId("account-item").filter({ hasText: "Beta Pending" }).getByTestId("account-item-pending")).toHaveCount(0);

    // What the store sees: the statement and the invoice print carry no note, and no word about the phone
    await page.goto(`/accounts/${a.id}/statement`);
    await expect(page.getByTestId("statement")).toBeVisible();
    await expect(page.getByTestId("pending-sync-note")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/waiting on this phone|pending sync|not counted yet/i);
    await page.goto(`/invoices/${invoice.invoiceId}/print`);
    await expect(page.locator("body")).not.toContainText(/waiting on this phone|pending sync|not counted yet/i);

    // Signing out is protected: the warning names the payment
    await page.goto(`/accounts/${a.id}`);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByTestId("sign-out-warning")).toContainText("1 payment is kept on this phone and not on the server yet");
    await page.getByRole("button", { name: "Stay signed in" }).click();

    // The server can be reached again: Send now sends it, the notes go and the balance is read again without a reload
    blocked = false;
    await page.getByTestId("pending-send-now").click();
    await expect(page.getByTestId("pending-sync-note")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByTestId("balance-pending-sync")).toHaveCount(0);
    await expect(page.getByTestId("account-balance")).toHaveText("Owes PKR 3,100.00");
    await expect(page.getByTestId("entry-row").filter({ hasText: "R9" })).toHaveCount(1);
    expect(await idbCount(page, "paymentOps")).toBe(0);
    expect(await balanceOfStore(freshTenant, a.id)).toBe("3100.00");
    expect(await paymentsOnServer(a.id)).toHaveLength(1);
    await page.goto("/");
    await expect(page.getByTestId("accounts-pending-note")).toHaveCount(0);
  });
});
