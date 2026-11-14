import type { Page } from "@playwright/test";
import { expect, signIn, test } from "./fixtures";
import { createOrder, seedStore } from "./orders-helpers";
import { seedMarketDay } from "./market-helpers";

// US1 of Module 005: one combined list of the day's confirmed orders, in the browser at 360 px.
test.describe("US1: the market list", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  const rowOf = (page: Page, strength: string) => page.getByTestId("market-row").filter({ hasText: strength });

  test("adds the day's orders by medicine, with each store's share, and ignores the draft", async ({ page, freshTenant }) => {
    await seedMarketDay(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/market-list");

    const panadol = rowOf(page, "500 mg").filter({ hasText: "Panadol" });
    await expect(panadol).toHaveCount(1);
    await expect(panadol.getByTestId("market-row-total")).toContainText("Total: 45 strip"); // 20 + 10 + 15, not the draft's 99
    const stores = panadol.getByTestId("market-store");
    await expect(stores).toHaveCount(3);
    await expect(stores.nth(0)).toContainText("Al Madina");
    await expect(stores.nth(0)).toContainText("20");
    await expect(stores.nth(1)).toContainText("Rehman Medical");
    await expect(stores.nth(1)).toContainText("15");
    await expect(stores.nth(2)).toContainText("Shah Medical");
    await expect(stores.nth(2)).toContainText("10");
    await expect(panadol.getByTestId("market-row-progress")).toHaveText("Nothing bought yet, 45 strip to buy");
  });

  test("keeps a different strength of the same name as its own row", async ({ page, freshTenant }) => {
    await seedMarketDay(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/market-list");
    await expect(page.getByTestId("market-row").filter({ hasText: "650 mg" })).toHaveCount(1);
    await expect(page.getByTestId("market-row").filter({ hasText: "650 mg" }).getByTestId("market-row-total")).toContainText("Total: 3 strip");
    await expect(page.getByTestId("market-row")).toHaveCount(3); // Brufen, Panadol 500 mg, Panadol 650 mg
  });

  test("shows typed medicines in their own group, grouped by the typed text, marked unregistered", async ({ page, freshTenant }) => {
    await seedMarketDay(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/market-list");
    const group = page.getByTestId("unregistered-group");
    await expect(group.getByRole("heading", { name: "Not yet registered" })).toBeVisible();
    const typed = group.getByTestId("market-typed-row");
    await expect(typed).toHaveCount(1); // "Noran 20mg cap" and "noran  20MG cap" are one entry
    await expect(typed.getByTestId("market-row-total")).toContainText("Total: 10 strip");
    await expect(typed.getByTestId("market-store")).toHaveCount(2);
    await expect(typed).toContainText("unregistered");
    await expect(typed.getByTestId("register-link")).toBeVisible();
    await expect(typed.getByTestId("record-purchase")).toHaveCount(0); // nothing can be bought until it is registered
    await expect(page.getByTestId("market-count")).toContainText("3 medicines, 1 not registered yet");
  });

  test("changes with the date, and an empty day names the next action", async ({ page, freshTenant }) => {
    await seedMarketDay(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/market-list");
    await expect(page.getByTestId("market-row")).toHaveCount(3);
    await page.getByTestId("market-date").fill("2026-01-01");
    await expect(page.getByTestId("empty-state")).toContainText("No confirmed orders for this date");
    await expect(page.getByTestId("empty-state").getByRole("link", { name: "Take an order" })).toHaveAttribute("href", "/orders/new");
    await expect(page.getByTestId("market-row")).toHaveCount(0);
    await page.getByRole("button", { name: "Go to today" }).click();
    await expect(page.getByTestId("market-row")).toHaveCount(3);
  });

  test("follows the orders: a new confirmed order shows after Refresh", async ({ page, freshTenant }) => {
    const seed = await seedMarketDay(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/market-list");
    const panadol = page.getByTestId("market-row").filter({ hasText: "500 mg" });
    await expect(panadol.getByTestId("market-row-total")).toContainText("Total: 45 strip");
    const fourth = await seedStore(freshTenant, "Noor Pharmacy");
    await createOrder(freshTenant, fourth, [{ product_id: seed.panadol500, quantity: 5, unit: "strip" }], { confirm: true });
    await page.getByTestId("market-refresh").click();
    await expect(panadol.getByTestId("market-row-total")).toContainText("Total: 50 strip");
    await expect(panadol.getByTestId("market-store")).toHaveCount(4);
  });

  test("shows a loading state, and an error with Retry that recovers (never an empty list)", async ({ page, freshTenant }) => {
    await seedMarketDay(freshTenant);
    await signIn(page, freshTenant);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/market-list?**", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/market-list");
    await expect(page.getByRole("status", { name: /Loading the market list/ }).or(page.getByText("Loading the market list…"))).toBeVisible();
    release();
    await expect(page.getByTestId("market-row")).toHaveCount(3);

    await page.unroute("**/api/market-list?**");
    let fail = true;
    await page.route("**/api/market-list?**", (route) => (fail ? route.fulfill({ status: 500, json: { code: "server_error", message: "Something went wrong. Please try again." } }) : route.continue()));
    await page.goto("/market-list?date=2026-01-02");
    await expect(page.getByTestId("error-state")).toBeVisible();
    await expect(page.getByTestId("empty-state")).toHaveCount(0);
    fail = false;
    await page.getByTestId("error-state").getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("empty-state")).toContainText("No confirmed orders for this date");
  });

  test("never shows a price, cost or MRP on the list", async ({ page, freshTenant }) => {
    await seedMarketDay(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/market-list");
    await expect(page.getByTestId("market-row")).toHaveCount(3);
    const text = await page.locator("main").innerText();
    for (const value of ["90.00", "125.50", "130.00", "95.00", "140.00", "70.00", "99.00", "PKR", "Rs"]) expect(text, value).not.toContain(value);
  });
});
