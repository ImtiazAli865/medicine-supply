import { expect, signIn, smallTargets, test } from "./fixtures";

// SC-007: at 360 px every interactive control is at least 44 x 44 px, and nothing overflows sideways.
test.describe("touch targets and layout at 360 px", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("sign-in screen", async ({ page, tenant }) => {
    void tenant;
    await page.goto("/sign-in");
    expect(await smallTargets(page)).toEqual([]);
  });

  test("every signed-in screen", async ({ page, tenant }) => {
    await signIn(page, tenant);
    for (const path of ["/", "/products", "/products/new", "/products/import", "/stores", "/stores/new", "/settings"]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      expect(await smallTargets(page), `small targets on ${path}`).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
    }
  });
});
