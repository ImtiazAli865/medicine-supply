import { expect, signIn, test } from "./fixtures";

test.describe("US2: business settings", () => {
  test.beforeEach(async ({ page, freshTenant }) => {
    await signIn(page, freshTenant, "/settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  });

  test("shows the defaults for a new business", async ({ page, freshTenant }) => {
    await expect(page.getByLabel(/Business name/)).toHaveValue(`${freshTenant.label} business`);
    await expect(page.getByLabel("Phone")).toHaveValue("");
    await expect(page.getByLabel("Address")).toHaveValue("");
    await expect(page.getByLabel(/Thermal receipt paper width/)).toHaveValue("80");
    await expect(page.getByLabel(/Print the Account Summary/)).not.toBeChecked();
  });

  test("saves every field, keeps it after reload, and updates the business name everywhere", async ({ page }) => {
    await page.getByLabel(/Business name/).fill("Acme Pharma");
    await page.getByLabel("Phone").fill("0300-1234567");
    await page.getByLabel("Address").fill("12 Mall Road, Lahore");
    await page.getByLabel(/Thermal receipt paper width/).fill("58");
    await page.getByLabel(/Print the Account Summary/).check();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();
    await expect(page.getByTestId("business-name")).toHaveText("Acme Pharma");

    await page.reload();
    await expect(page.getByLabel(/Business name/)).toHaveValue("Acme Pharma");
    await expect(page.getByLabel("Phone")).toHaveValue("0300-1234567");
    await expect(page.getByLabel("Address")).toHaveValue("12 Mall Road, Lahore");
    await expect(page.getByLabel(/Thermal receipt paper width/)).toHaveValue("58");
    await expect(page.getByLabel(/Print the Account Summary/)).toBeChecked();
    await expect(page.getByTestId("business-name")).toHaveText("Acme Pharma");
  });

  test("refuses a paper width outside 40-120, a decimal, text, and an empty name; nothing is saved", async ({ page, freshTenant }) => {
    const paper = page.getByLabel(/Thermal receipt paper width/);
    for (const [value, message] of [
      ["30", /at least 40/],
      ["130", /at most 120/],
      ["80.5", /whole number/],
      ["abc", /whole number/],
    ] as const) {
      await paper.fill(value);
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible();
      await expect(page.getByText("Settings saved.")).toHaveCount(0);
    }
    await paper.fill("80");
    await page.getByLabel(/Business name/).fill("   ");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Enter the business name" })).toBeVisible();

    await page.reload();
    await expect(page.getByLabel(/Business name/)).toHaveValue(`${freshTenant.label} business`);
    await expect(page.getByLabel(/Thermal receipt paper width/)).toHaveValue("80");
  });

  test("a save in another tab shows 'changed elsewhere' instead of overwriting", async ({ page, context }) => {
    const other = await context.newPage();
    await other.goto("/settings");
    await other.getByLabel(/Business name/).fill("From Tab Two");
    await other.getByRole("button", { name: "Save settings" }).click();
    await expect(other.getByText("Settings saved.")).toBeVisible();

    await page.getByLabel(/Business name/).fill("From Tab One");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByTestId("settings-conflict")).toContainText("changed elsewhere");
    await expect(page.getByLabel(/Business name/)).toHaveValue("From Tab One"); // typed values stay
    await expect(page.getByText("Settings saved.")).toHaveCount(0);

    await page.getByRole("button", { name: "Load latest" }).click();
    await expect(page.getByLabel(/Business name/)).toHaveValue("From Tab Two");
  });

  test("a failed save shows an error, keeps the typed values and never a success message", async ({ page }) => {
    await page.route("**/api/settings", (route) => (route.request().method() === "PATCH" ? route.abort() : route.continue()));
    await page.getByLabel(/Business name/).fill("Typed Name");
    await page.getByLabel("Phone").fill("0301");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /Can't reach the server/ })).toBeVisible();
    await expect(page.getByLabel(/Business name/)).toHaveValue("Typed Name");
    await expect(page.getByLabel("Phone")).toHaveValue("0301");
    await expect(page.getByText("Settings saved.")).toHaveCount(0);
  });
});

test.describe("Module 002 API without a session", () => {
  test("every route refuses a signed-out visitor with 401 and returns no data", async ({ request, tenant }) => {
    void tenant;
    const checks: [string, string][] = [
      ["GET", "/api/settings"], ["PATCH", "/api/settings"], ["GET", "/api/setup"], ["PATCH", "/api/setup/checklist"],
      ["GET", "/api/imports"], ["POST", "/api/imports"], ["POST", "/api/imports/preview"],
      ["GET", "/api/imports/00000000-0000-4000-8000-000000000000"],
    ];
    for (const [method, url] of checks) {
      const res = await request.fetch(url, { method, data: method === "GET" ? undefined : {} });
      expect(res.status(), `${method} ${url}`).toBe(401);
      expect(await res.json()).toMatchObject({ code: "unauthenticated" });
    }
  });
});
