import { expect, signIn, test, uniqueName } from "./fixtures";

test.describe("US2: stores", () => {
  test.beforeEach(async ({ page, tenant }) => {
    await signIn(page, tenant);
  });

  test("add with only a name, search by part of it, edit, deactivate and reactivate", async ({ page }) => {
    const name = uniqueName("Al Madina");
    await page.goto("/stores/new");
    await page.getByLabel(/Store name/).fill(name);
    await page.getByRole("button", { name: "Add store" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();

    await page.goto("/stores");
    await page.getByLabel("Search stores").fill(name.slice(3, 12).toLowerCase());
    await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();

    await page.getByRole("link", { name: new RegExp(name) }).click();
    await page.getByRole("link", { name: "Edit" }).click();
    await page.getByLabel("Phone").fill("0300-1234567");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("0300-1234567")).toBeVisible();

    await page.getByRole("button", { name: "Deactivate" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByText("Inactive").first()).toBeVisible();

    await page.goto("/stores");
    await page.getByLabel("Search stores").fill(name);
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await page.getByRole("button", { name: "Inactive" }).click();
    await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();

    await page.getByRole("link", { name: new RegExp(name) }).click();
    await page.getByRole("button", { name: "Reactivate" }).click();
    await expect(page.getByRole("button", { name: "Deactivate" })).toBeVisible();
  });

  test("a same-name store asks for confirmation before it is added", async ({ page }) => {
    const name = uniqueName("Shah Medical");
    for (let i = 0; i < 2; i++) {
      await page.goto("/stores/new");
      await page.getByLabel(/Store name/).fill(name);
      await page.getByRole("button", { name: "Add store" }).click();
      if (i === 0) await expect(page.getByRole("heading", { name })).toBeVisible();
    }
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("A store with this name exists");
    await dialog.getByRole("button", { name: "Add anyway" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
  });

  test("a failed save keeps the typed data and shows no success", async ({ page }) => {
    await page.goto("/stores/new");
    await page.getByLabel(/Store name/).fill("Offline Store");
    await page.getByLabel("Phone").fill("123");
    await page.route("**/api/stores", (route) => route.abort());
    await page.getByRole("button", { name: "Add store" }).click();
    await expect(page.getByText("Can't reach the server. Check your connection and try again.")).toBeVisible();
    await expect(page.getByLabel(/Store name/)).toHaveValue("Offline Store");
    await expect(page.getByLabel("Phone")).toHaveValue("123");
    await expect(page.getByText("Store added.")).toHaveCount(0);
  });

  test("a store edited in another tab shows the version-conflict message", async ({ page, context }) => {
    const name = uniqueName("Conflict");
    await page.goto("/stores/new");
    await page.getByLabel(/Store name/).fill(name);
    await page.getByRole("button", { name: "Add store" }).click();
    await page.getByRole("link", { name: "Edit" }).click();
    await page.waitForURL(/\/stores\/[^/]+\/edit$/);
    const editUrl = page.url();

    const other = await context.newPage();
    await other.goto(editUrl);
    await other.getByLabel("Phone").fill("111");
    await other.getByRole("button", { name: "Save changes" }).click();
    await expect(other.getByText("111")).toBeVisible();

    await page.getByLabel("Phone").fill("222");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("This store was changed elsewhere.")).toBeVisible();
    await expect(page.getByLabel("Phone")).toHaveValue("222");
    await page.getByRole("button", { name: "Load latest" }).click();
    await expect(page.getByLabel("Phone")).toHaveValue("111");
  });

  test("the first-time empty state names the next action", async ({ page }) => {
    // A fresh business shows "Add your first store"; once stores exist the list is shown instead.
    await page.goto("/stores");
    const empty = page.getByTestId("empty-state");
    if (await empty.isVisible().catch(() => false)) {
      await expect(empty).toContainText("Add your first store");
    } else {
      await expect(page.getByRole("list").first()).toBeVisible();
    }
  });
});
