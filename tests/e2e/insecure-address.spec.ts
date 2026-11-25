import type { Page } from "@playwright/test";
import { expect, signIn, test } from "./fixtures";

// Module 011, US5: a visible notice when the offline worker cannot start because the address is not secure (https or localhost).
// The tests run on localhost, which is a secure address, so the notice must be absent; the other case is made by telling the page
// that its address is not a secure context before any script of the app runs (mobile, 360 px).
test.describe("US5: the notice for an address that is not secure", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(120_000);

  async function waitForApp(page: Page, path: string) {
    await page.goto(path);
    await expect(page.getByTestId("business-name")).toBeVisible();
    await expect(page.getByTestId("sync-indicator")).toBeVisible();
  }

  test("is never shown on localhost, which is a secure address", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    for (const path of ["/", "/orders", "/settings"]) {
      await waitForApp(page, path);
      await page.waitForTimeout(500);
      await expect(page.getByTestId("insecure-address-notice"), path).toHaveCount(0);
    }
    expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  });

  test("is shown on an address that is not secure, with the plain sentence, a Close control, and no sideways scroll", async ({ page, freshTenant }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "isSecureContext", { configurable: true, get: () => false });
    });
    await signIn(page, freshTenant);
    for (const path of ["/", "/orders", "/settings"]) {
      await waitForApp(page, path);
      const notice = page.getByTestId("insecure-address-notice");
      await expect(notice, path).toBeVisible();
      await expect(notice).toHaveAttribute("data-kind", "insecure_address");
      await expect(notice).toContainText("Offline mode cannot start on this address because it is not https.");
      await expect(notice).toContainText("Use the https address of the app (or localhost on a computer) to work without the internet.");
    }
    const close = page.getByTestId("insecure-address-close");
    const box = await close.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(43.5);
    expect(box!.height).toBeGreaterThanOrEqual(43.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    // Closing hides it for this visit only: the app is not blocked, and a new visit shows it again.
    await close.click();
    await expect(page.getByTestId("insecure-address-notice")).toHaveCount(0);
    await expect(page.getByTestId("business-name")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("insecure-address-notice")).toBeVisible();
  });

  test("never says anything about money and never blocks the screen under it", async ({ page, freshTenant }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "isSecureContext", { configurable: true, get: () => false });
    });
    await signIn(page, freshTenant);
    await waitForApp(page, "/orders");
    await expect(page.getByTestId("insecure-address-notice")).not.toContainText(/balance|invoice|ledger|price|cost|profit|margin|payment/i);
    await expect(page.getByRole("link", { name: /new order/i }).first()).toBeVisible();
  });
});
