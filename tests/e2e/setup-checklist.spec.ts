import { randomUUID } from "node:crypto";
import { expect, signIn, test } from "./fixtures";

test.describe("US3: first-time setup checklist", () => {
  test.beforeEach(async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
  });

  test("a new business sees exactly three not-done items with working buttons", async ({ page }) => {
    const card = page.getByTestId("setup-checklist");
    await expect(card).toBeVisible();
    for (const key of ["details", "stores", "catalog"]) {
      await expect(card.getByTestId(`setup-${key}`)).toHaveAttribute("data-done", "false");
    }
    await expect(card.locator('[data-testid^="setup-"][data-done]')).toHaveCount(3);
    await expect(card).toContainText("Every step is optional");
    await expect(card.getByTestId("setup-stores")).toContainText("while taking your first order");
    await expect(card.getByTestId("setup-catalog")).toContainText("optional");

    await card.getByTestId("setup-details").getByRole("link").click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.goBack();
    await page.getByTestId("setup-checklist").getByTestId("setup-stores").getByRole("link").click();
    await expect(page).toHaveURL(/\/stores\/new$/);
    await page.goBack();
    await page.getByTestId("setup-checklist").getByTestId("setup-catalog").getByRole("link").click();
    await expect(page).toHaveURL(/\/products\/import$/);
  });

  test("nothing is blocked while items are not done", async ({ page }) => {
    for (const [path, heading] of [["/products", "Products"], ["/stores", "Stores"], ["/products/new", "Add medicine"], ["/stores/new", "Add store"]] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, level: path === "/products" || path === "/stores" ? 1 : undefined }).first()).toBeVisible();
    }
  });

  test("each item turns done from real data, in any order, and a finished checklist says Setup complete", async ({ page, freshTenant }) => {
    const done = (key: string) => page.getByTestId("setup-checklist").getByTestId(`setup-${key}`);

    // medicine added by hand counts as the catalog item
    await freshTenant.client.from("products").insert({ id: randomUUID(), name: "By Hand", unit: "strip" });
    await page.goto("/");
    await expect(done("catalog")).toHaveAttribute("data-done", "true");
    await expect(done("stores")).toHaveAttribute("data-done", "false");

    await freshTenant.client.from("stores").insert({ id: randomUUID(), name: "First Store" });
    await page.goto("/");
    await expect(done("stores")).toHaveAttribute("data-done", "true");
    await expect(done("details")).toHaveAttribute("data-done", "false");

    await page.goto("/settings");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();
    await page.goto("/");
    await expect(done("details")).toHaveAttribute("data-done", "true");
    await expect(page.getByTestId("setup-checklist")).toContainText("Setup complete");
  });

  test("dismissing hides it, stays hidden after reload, and Settings brings it back", async ({ page }) => {
    await page.getByTestId("dismiss-checklist").click();
    await expect(page.getByTestId("setup-checklist")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    await expect(page.getByTestId("setup-checklist")).toHaveCount(0);

    await page.goto("/settings");
    await page.getByRole("button", { name: "Show setup checklist" }).click();
    await expect(page.getByText("The setup checklist will show on Home.")).toBeVisible();
    await page.goto("/");
    await expect(page.getByTestId("setup-checklist")).toBeVisible();
  });

  test("a failed dismiss shows an error and keeps the checklist", async ({ page }) => {
    await page.route("**/api/setup/checklist", (route) => route.abort());
    await page.getByTestId("dismiss-checklist").click();
    await expect(page.getByTestId("setup-checklist").getByRole("alert")).toBeVisible();
    await expect(page.getByTestId("setup-checklist")).toBeVisible();
  });
});
