import { expect, signIn, test, uniqueName } from "./fixtures";

test.describe("US3: medicines", () => {
  test.beforeEach(async ({ page, tenant }) => {
    await signIn(page, tenant);
  });

  test("add with only name and unit; the product shows 'No selling price' and no invented values", async ({ page }) => {
    const name = uniqueName("Brufen");
    await page.goto("/products/new");
    await page.getByLabel(/Medicine name/).fill(name);
    await page.getByLabel(/^Unit/).selectOption("strip");
    await page.getByRole("button", { name: "Add medicine" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText("No selling price").first()).toBeVisible();
    await expect(page.getByTestId("unit-gross-profit")).toHaveText("Not available");
  });

  test("shows unit gross profit exactly and warns (without blocking) on odd prices", async ({ page }) => {
    const name = uniqueName("Priced");
    await page.goto("/products/new");
    await page.getByLabel(/Medicine name/).fill(name);
    await page.getByLabel(/^Unit/).selectOption("box");
    await page.getByLabel("Purchase price").fill("99.99");
    await page.getByLabel("Selling price").fill("125.50");
    await page.getByLabel("MRP").fill("120");
    await expect(page.getByText("The MRP is lower than the selling price")).toBeVisible();
    await page.getByRole("button", { name: "Add medicine" }).click();
    await expect(page.getByTestId("unit-gross-profit")).toHaveText("PKR 25.51");
  });

  test("rejects an invalid price and keeps the form", async ({ page }) => {
    await page.goto("/products/new");
    await page.getByLabel(/Medicine name/).fill(uniqueName("Bad Price"));
    await page.getByLabel(/^Unit/).selectOption("strip");
    await page.getByLabel("Selling price").fill("-5");
    await page.getByRole("button", { name: "Add medicine" }).click();
    await expect(page.getByText(/no negatives, at most two decimals/)).toBeVisible();
    await expect(page).toHaveURL(/\/products\/new/);
  });

  test("search-as-you-type suggests matching medicines and opens one with a tap", async ({ page }) => {
    const unique = uniqueName("Panadol").replace(" ", "-");
    await page.goto("/products/new");
    await page.getByLabel(/Medicine name/).fill(unique);
    await page.getByLabel(/^Unit/).selectOption("strip");
    await page.getByRole("button", { name: "Add medicine" }).click();
    await expect(page.getByRole("heading", { name: unique })).toBeVisible();

    await page.goto("/products");
    await page.getByLabel("Search medicines").fill(unique.slice(0, 5).toLowerCase());
    await page.getByRole("link", { name: new RegExp(unique) }).click();
    await expect(page.getByRole("heading", { name: unique })).toBeVisible();
  });

  test("an exact duplicate is blocked; a different strength needs confirmation", async ({ page }) => {
    const name = uniqueName("Augmentin");
    const add = async (strength: string) => {
      await page.goto("/products/new");
      await page.getByLabel(/Medicine name/).fill(name);
      await page.getByLabel(/^Unit/).selectOption("strip");
      await page.getByLabel("Strength").fill(strength);
      await page.getByRole("button", { name: "Add medicine" }).click();
    };

    await add("375 mg");
    await expect(page.getByRole("heading", { name })).toBeVisible();

    await add("375 mg");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("This medicine already exists");
    await expect(dialog.getByRole("link", { name: "Open existing" })).toBeVisible();
    await dialog.getByRole("button", { name: "Go back" }).click();

    await add("625 mg");
    await expect(page.getByRole("dialog")).toContainText("Similar medicines exist");
    await page.getByRole("dialog").getByRole("button", { name: "Create as separate product" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
  });

  test("a duplicate of an inactive product offers to reactivate it", async ({ page }) => {
    const name = uniqueName("Dormant");
    await page.goto("/products/new");
    await page.getByLabel(/Medicine name/).fill(name);
    await page.getByLabel(/^Unit/).selectOption("strip");
    await page.getByRole("button", { name: "Add medicine" }).click();
    await page.getByRole("button", { name: "Deactivate" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByRole("button", { name: "Reactivate" })).toBeVisible();

    await page.goto("/products/new");
    await page.getByLabel(/Medicine name/).fill(name);
    await page.getByLabel(/^Unit/).selectOption("box");
    await page.getByRole("button", { name: "Add medicine" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reactivate existing" }).click();
    await expect(page.getByRole("button", { name: "Deactivate" })).toBeVisible();
  });

  test("a failed save keeps the typed data and shows no success", async ({ page }) => {
    await page.goto("/products/new");
    await page.getByLabel(/Medicine name/).fill("Offline Medicine");
    await page.getByLabel(/^Unit/).selectOption("strip");
    await page.route("**/api/products", (route) => route.abort());
    await page.getByRole("button", { name: "Add medicine" }).click();
    await expect(page.getByText("Can't reach the server. Check your connection and try again.")).toBeVisible();
    await expect(page.getByLabel(/Medicine name/)).toHaveValue("Offline Medicine");
    await expect(page.getByText("Medicine added.")).toHaveCount(0);
  });

  test("a medicine edited in another tab shows the version-conflict message", async ({ page, context }) => {
    const name = uniqueName("Conflict");
    await page.goto("/products/new");
    await page.getByLabel(/Medicine name/).fill(name);
    await page.getByLabel(/^Unit/).selectOption("strip");
    await page.getByRole("button", { name: "Add medicine" }).click();
    await page.getByRole("link", { name: "Edit" }).click();
    await page.waitForURL(/\/products\/[^/]+\/edit$/);
    const editUrl = page.url();

    const other = await context.newPage();
    await other.goto(editUrl);
    await other.getByLabel("Brand").fill("First");
    await other.getByRole("button", { name: "Save changes" }).click();
    await expect(other.getByText("First")).toBeVisible();

    await page.getByLabel("Brand").fill("Stale");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("This medicine was changed elsewhere.")).toBeVisible();
    await expect(page.getByLabel("Brand")).toHaveValue("Stale");
  });
});
