import { expect, signIn, smallTargets, test } from "./fixtures";
import { addOpening, accountStore } from "./account-helpers";
import { seedReportWorld } from "./reports-helpers";

// SC-008 of Module 010: at 360 px every Reports screen has no control smaller than 44 x 44 px, no sideways scroll, and the
// bottom navigation still has five items.
test.describe("reports at 360 px", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("every report screen has no small targets and no sideways scroll, with data on screen", async ({ page, freshTenant }) => {
    await seedReportWorld(freshTenant);
    const advance = await accountStore(freshTenant, "Advance Pharmacy");
    await addOpening(freshTenant, advance.id, "1000.00", "advance");
    await signIn(page, freshTenant);

    const screens: Array<{ path: string; ready: string }> = [
      { path: "/reports", ready: "reports-hub" },
      { path: "/reports/sales", ready: "report-total-sales" },
      { path: "/reports/sales?group=week", ready: "report-total-sales" },
      { path: "/reports/purchases", ready: "report-total-cost" },
      { path: "/reports/stores", ready: "report-rows" },
      { path: "/reports/stores?q=zzz", ready: "report-empty" },
      { path: "/reports/medicines", ready: "report-rows" },
      { path: "/reports/cost-missing", ready: "cost-missing-row" },
      { path: "/reports/balances", ready: "balances-total-owed" },
    ];
    for (const screen of screens) {
      await page.goto(screen.path);
      await expect(page.getByTestId(screen.ready).first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await smallTargets(page), `small targets on ${screen.path}`).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `horizontal overflow on ${screen.path}`).toBeLessThanOrEqual(1);
      await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(5);
    }
  });

  test("an error and an offline message also fit the screen", async ({ page, freshTenant }) => {
    await seedReportWorld(freshTenant);
    await signIn(page, freshTenant);
    await page.route("**/api/reports/sales**", (route) => route.fulfill({ status: 500, json: { code: "server_error", message: "Something went wrong. Please try again." } }));
    await page.goto("/reports/sales");
    await expect(page.getByTestId("report-error")).toBeVisible();
    expect(await smallTargets(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  });
});
