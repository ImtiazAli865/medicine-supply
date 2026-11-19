import { seedStore, startOrder, line, waitSaved } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US5 of Module 008: day one. No catalog, no history, no stores: the screen works and names the next step (mobile, 360 px).
test.describe("US5: first use", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("an empty catalog and a store with no history: the empty states name the next step and the typed path takes the order", async ({ page, freshTenant }) => {
    await seedStore(freshTenant, "Day One Store");
    await signIn(page, freshTenant);
    await startOrder(page, "Day One Store");

    await expect(page.getByTestId("catalog-empty")).toContainText("Your catalog is empty");
    await expect(page.getByRole("link", { name: "Add a medicine" })).toHaveAttribute("href", "/products/new");
    await expect(page.getByRole("link", { name: "Import a list" })).toHaveAttribute("href", "/products/import");
    await expect(page.getByTestId("usual-empty")).toContainText("after its first confirmed orders");
    await expect(page.getByTestId("usual-card")).toHaveCount(0);
    await expect(page.getByTestId("repeat-last-order")).toHaveCount(0);
    await expect(page.getByTestId("no-lines")).toContainText("Search above");

    await page.getByTestId("fast-search").fill("Noran 20mg cap");
    await page.getByTestId("add-as-typed").click();
    const form = page.getByTestId("typed-form");
    await form.getByLabel("Quantity").fill("3");
    await form.getByLabel("Unit").fill("strip");
    await form.getByTestId("add-typed-line").click();
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await expect(line(page, 0)).toContainText("Not registered");
    await waitSaved(page);
    await expect(page.getByTestId("confirm-order")).toBeEnabled(); // an order of typed lines is never blocked
  });

  test("a business with no stores keeps the existing first-store step", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/orders/new");
    await expect(page.getByTestId("no-stores")).toBeVisible();
    await expect(page.getByTestId("add-new-store")).toBeVisible();
  });
});
