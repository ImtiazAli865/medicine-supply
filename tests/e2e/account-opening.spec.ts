import { expect, signIn, test } from "./fixtures";
import { accountStore, addOpening, openAccount } from "./account-helpers";

// User Story 1 of Module 007: see a store account and enter its opening balance. Mobile project only.
test.describe("US1: store account and opening balance", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("the Stores screen links to the list, which says what to do when there are no stores", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/stores");
    await page.getByTestId("store-accounts-link").click();
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(page.getByTestId("empty-state")).toContainText("No stores yet");
    await expect(page.getByRole("link", { name: "Add a store" })).toBeVisible();
  });

  test("the list shows every store with its balance, stores that owe first, and filters", async ({ page, freshTenant }) => {
    const owes = await accountStore(freshTenant, "Nimer Medical");
    const empty = await accountStore(freshTenant, "Al Shifa Pharmacy");
    await addOpening(freshTenant, owes.id, "12000.00", "owes");
    await signIn(page, freshTenant);
    await page.goto("/accounts");
    const items = page.getByTestId("account-item");
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText("Nimer Medical");
    await expect(items.first().getByTestId("account-item-balance")).toHaveText("Owes PKR 12,000.00");
    await expect(items.nth(1)).toContainText(empty.name);
    await expect(items.nth(1).getByTestId("account-item-balance")).toHaveText("Settled");
    await expect(items.nth(1)).toContainText("No entries yet");

    await page.getByTestId("filter-owing").click();
    await expect(items).toHaveCount(1);
    await page.getByRole("searchbox", { name: "Search stores" }).fill("zzz");
    await expect(page.getByTestId("empty-state")).toContainText("No stores match");
  });

  test("a store with no entries shows a balance of nothing owed and an empty state with the next action", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await signIn(page, freshTenant);
    await openAccount(page, store.id);
    await expect(page.getByTestId("account-balance")).toHaveText("Settled");
    await expect(page.getByTestId("account-balance-sentence")).toHaveText("Nothing is owed on this account.");
    await expect(page.getByTestId("empty-state")).toContainText("No entries yet");
    await expect(page.getByTestId("empty-state").getByRole("button", { name: "Add opening balance" })).toBeVisible();
  });

  test("adds an opening balance in each direction after reading the warning, and keeps every entry", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await signIn(page, freshTenant);
    await openAccount(page, store.id);

    await page.getByTestId("open-opening").click();
    await expect(page.getByRole("dialog")).toContainText("not");
    await expect(page.getByRole("dialog")).toContainText("counted twice");
    await page.getByTestId("opening-amount").fill("12000");
    await page.getByTestId("opening-note").fill("From the paper khata");
    await page.getByTestId("opening-save").click();
    await expect(page.getByTestId("account-notice")).toHaveText("Opening balance saved.");
    await expect(page.getByTestId("account-balance")).toHaveText("Owes PKR 12,000.00");
    await expect(page.getByTestId("entry-row")).toHaveCount(1);
    await expect(page.getByTestId("entry-row").first()).toContainText("Opening balance");
    await expect(page.getByTestId("entry-row").first().getByTestId("entry-running")).toContainText("Owes PKR 12,000.00");
    await expect(page.getByTestId("open-item")).toHaveCount(1);

    // a second opening balance on a later day, the store paid 500 in advance: both kept
    await page.getByTestId("open-opening").click();
    await page.getByTestId("opening-direction").selectOption("advance");
    await page.getByTestId("opening-amount").fill("500.00");
    await page.getByTestId("opening-save").click();
    await expect(page.getByTestId("entry-row")).toHaveCount(2);
    await expect(page.getByTestId("account-balance")).toHaveText("Owes PKR 11,500.00");
  });

  test("shows an error and keeps the form for an invalid amount and a future date", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await signIn(page, freshTenant);
    await openAccount(page, store.id);
    await page.getByTestId("open-opening").click();
    await page.getByTestId("opening-amount").fill("12.345");
    await page.getByTestId("opening-save").click();
    await expect(page.getByRole("dialog")).toContainText("Enter an amount above 0 with at most two decimals.");
    await page.getByTestId("opening-amount").fill("100");
    // A future date is stopped by the date field itself (its latest date is today); the server also refuses it.
    await page.getByTestId("opening-date").fill("2999-01-01");
    expect(await page.getByTestId("opening-date").evaluate((el) => (el as HTMLInputElement).validity.rangeOverflow)).toBe(true);
    await page.getByTestId("opening-save").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByTestId("account-notice")).toHaveCount(0);
    await expect(page.getByTestId("opening-amount")).toHaveValue("100");
  });

  test("records one entry when Save is tapped twice quickly and after a reload", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await signIn(page, freshTenant);
    await openAccount(page, store.id);
    await page.getByTestId("open-opening").click();
    await page.getByTestId("opening-amount").fill("250");
    await page.getByTestId("opening-save").dblclick();
    await expect(page.getByTestId("account-notice")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByTestId("entry-row")).toHaveCount(1);
    await expect(page.getByTestId("account-balance")).toHaveText("Owes PKR 250.00");
  });

  test("a failed save shows an error, keeps the form and never claims it was saved on this device", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await signIn(page, freshTenant);
    await openAccount(page, store.id);
    let fail = true;
    await page.route("**/api/accounts/*/opening-balances", (route) =>
      fail ? route.fulfill({ status: 500, json: { code: "server_error", message: "Something went wrong. Please try again." } }) : route.continue(),
    );
    await page.getByTestId("open-opening").click();
    await page.getByTestId("opening-amount").fill("900");
    await page.getByTestId("opening-save").click();
    await expect(page.getByRole("dialog")).toContainText("Something went wrong. Please try again.");
    await expect(page.getByTestId("opening-amount")).toHaveValue("900");
    await expect(page.locator("body")).not.toContainText(/saved on this device|pending sync/i);
    fail = false;
    await page.getByTestId("opening-save").click();
    await expect(page.getByTestId("entry-row")).toHaveCount(1);
  });

  test("shows a loading state and an error with Retry on the account screen", async ({ page, freshTenant }) => {
    const store = await accountStore(freshTenant);
    await signIn(page, freshTenant);
    let fail = true;
    await page.route(`**/api/accounts/${store.id}?*`, (route) =>
      fail ? route.fulfill({ status: 500, json: { code: "server_error", message: "Something went wrong. Please try again." } }) : route.continue(),
    );
    await page.goto(`/accounts/${store.id}`);
    await expect(page.getByTestId("error-state")).toBeVisible({ timeout: 15_000 });
    fail = false;
    await page.getByTestId("error-state").getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("account-balance-card")).toBeVisible();
  });
});
