import { createTenant, deleteTenant, hasTestEnv } from "../helpers/supabase-test";
import { expect, signIn, test } from "./fixtures";

test.describe("US1: sign in and protected screens", () => {
  test("signed-out visitors are sent to sign-in and returned to the screen they asked for", async ({ page, tenant }) => {
    await page.goto("/products");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fproducts/);
    await page.getByLabel("Email").fill(tenant.email);
    await page.getByLabel("Password").fill(tenant.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/products$/);
    await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
  });

  test("every protected address redirects when signed out", async ({ page, tenant }) => {
    void tenant;
    for (const path of ["/", "/products", "/products/new", "/stores", "/stores/new"]) {
      await page.goto(path);
      await expect(page, `path ${path}`).toHaveURL(/\/sign-in/);
    }
  });

  test("wrong credentials show a non-revealing error and create no session", async ({ page, tenant }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(tenant.email);
    await page.getByLabel("Password").fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    await page.getByLabel("Email").fill("nobody-at-all@example.test");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    await page.goto("/products");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("a network failure shows a connection error, never success", async ({ page, tenant }) => {
    await page.route("**/auth/v1/token**", (route) => route.abort());
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(tenant.email);
    await page.getByLabel("Password").fill(tenant.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Can't reach the server. Check your connection and try again.")).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("sign out ends the session and Back does not reveal protected data", async ({ page, tenant }) => {
    await signIn(page, tenant);
    await expect(page.getByRole("link", { name: "Products" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goBack();
    await page.reload();
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByTestId("business-name")).toHaveCount(0);
  });

  test("stays signed in when the browser is reopened with the stored session (FR-003)", async ({ browser, page, tenant }) => {
    await signIn(page, tenant);
    const state = await page.context().storageState();
    const reopened = await browser.newContext({ storageState: state });
    const next = await reopened.newPage();
    await next.goto("/");
    await expect(next).not.toHaveURL(/\/sign-in/);
    await expect(next.getByTestId("business-name")).toBeVisible();
    await reopened.close();
  });

  test("an expired session keeps the open form and its text, and shows the notice", async ({ page, tenant }) => {
    await signIn(page, tenant);
    await page.goto("/stores/new");
    await page.getByLabel(/Store name/).fill("Typed Before Expiry");
    await page.context().clearCookies();
    await page.getByRole("button", { name: "Add store" }).click();
    await expect(page.getByTestId("session-expired")).toBeVisible();
    await expect(page.getByLabel(/Store name/)).toHaveValue("Typed Before Expiry");
    await expect(page.getByRole("link", { name: "Sign in again" })).toHaveAttribute("target", "_blank");
  });

  test("API routes answer 401 JSON to signed-out callers and return no data", async ({ request, tenant }) => {
    void tenant;
    for (const path of ["/api/stores", "/api/products", "/api/stores/similar?name=x", "/api/products/similar?name=x"]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(401);
      expect(await response.json()).toMatchObject({ code: "unauthenticated" });
    }
  });
});

test.describe("US1: account without a business", () => {
  test("shows 'account not set up' and the API answers 403", async ({ page }) => {
    test.skip(!hasTestEnv, "needs the Supabase test project");
    const orphan = await createTenant("e2e-orphan", false);
    try {
      await signIn(page, orphan);
      await expect(page).toHaveURL(/\/account-not-set-up/);
      await expect(page.getByRole("heading", { name: /not set up/i })).toBeVisible();
      const response = await page.request.get("/api/stores");
      expect(response.status()).toBe(403);
      expect(await response.json()).toMatchObject({ code: "no_business" });
    } finally {
      await deleteTenant(orphan);
    }
  });
});
