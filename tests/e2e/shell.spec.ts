import { expect, signIn, test } from "./fixtures";

// US4: navigation. Runs in both projects; on the mobile project the nav is the bottom bar.
test.describe("US4: app shell and navigation", () => {
  test.beforeEach(async ({ page, tenant }) => {
    await signIn(page, tenant);
  });

  test("every navigation item opens a working screen and highlights itself", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Main" });
    const targets = [
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
