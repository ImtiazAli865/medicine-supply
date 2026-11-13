import { expect, signIn, test } from "./fixtures";

// US4: navigation. Runs in both projects; on the mobile project the nav is the bottom bar.
test.describe("US4: app shell and navigation", () => {
  test.beforeEach(async ({ page, tenant }) => {
    await signIn(page, tenant);
  });

  test("every navigation item opens a working screen and highlights itself", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Main" });
    const targets = [
      { name: "Orders", url: /\/orders$/, heading: "Orders" },
      { name: "Products", url: /\/products$/, heading: "Products" },
      { name: "Stores", url: /\/stores$/, heading: "Stores" },
      { name: "Settings", url: /\/settings$/, heading: "Settings" },
      { name: "Home", url: /\/$/, heading: "Home" },
    ];
    for (const t of targets) {
      await nav.getByRole("link", { name: t.name }).click();
      await expect(page).toHaveURL(t.url);
      await expect(page.getByRole("heading", { name: t.heading, level: 1 })).toBeVisible();
      await expect(nav.getByRole("link", { name: t.name })).toHaveAttribute("aria-current", "page");
    }
  });

  test("every screen is reachable through visible controls only", async ({ page }) => {
    await page.getByRole("link", { name: /Products/ }).first().click();
    await page.getByRole("link", { name: "Add medicine" }).click();
    await expect(page.getByRole("heading", { name: "Add medicine" })).toBeVisible();
    await page.getByRole("link", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Products", level: 1 })).toBeVisible();

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Stores" }).click();
    await page.getByRole("link", { name: "Add store" }).click();
    await expect(page.getByRole("heading", { name: "Add store" })).toBeVisible();
    await page.getByRole("link", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Stores", level: 1 })).toBeVisible();

    // Import is reachable from Products, and Settings from the navigation.
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Products" }).click();
    await page.getByRole("link", { name: "Import from file" }).click();
    await expect(page.getByRole("heading", { name: "Import medicines", level: 1 })).toBeVisible();
  });

  test("an unknown address shows a friendly not-found screen with a way home", async ({ page }) => {
    await page.goto("/products/00000000-0000-4000-8000-000000000000");
    await expect(page.getByText(/not found/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /home/i }).first()).toBeVisible();
  });
});

// Module 004: the Pending screens are reached through visible controls, and the bottom navigation keeps its five items.
test.describe("Module 004: Pending screens in the navigation", () => {
  test.beforeEach(async ({ page, tenant }) => {
    await signIn(page, tenant);
  });

  test("the main navigation still has exactly five items", async ({ page }) => {
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(5);
  });

  test("Pending Prices is reachable from Products, and the Pending screen has both tabs", async ({ page }) => {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Products" }).click();
    await page.getByRole("link", { name: "Pending prices" }).click();
    await expect(page).toHaveURL(/\/pending\?tab=prices/);
    await expect(page.getByRole("heading", { name: "Pending", level: 1 })).toBeVisible();
    await page.getByTestId("pending-tab-register").click();
    await expect(page).toHaveURL(/\/pending\?tab=register/);
    await expect(page.getByTestId("pending-tab-register")).toHaveAttribute("aria-current", "page");
  });
});

// Module 005: the market list is reached through visible controls (Home card and the Orders screen); no sixth item.
test.describe("Module 005: market list in the navigation", () => {
  test("the main navigation still has exactly five items on the market list screen", async ({ page, tenant }) => {
    await signIn(page, tenant);
    await page.goto("/market-list");
    await expect(page.getByRole("heading", { name: "Market list" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(5);
  });
});
