import type { Page } from "@playwright/test";
import { insertMedicines } from "../helpers/fast";
import { countOrders, goOffline, goOnline, waitDeviceReady } from "../helpers/offline";
import { createTenant, deleteTenant, type TestTenant } from "../helpers/supabase-test";
import { seedStore } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// SC-005 of Module 009: two businesses on one phone never see or send each other's orders (mobile, 360 px).
test.describe("US3: two businesses on one phone", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(180_000);

  async function seed(tenant: TestTenant, storeName: string, medicineName: string) {
    await insertMedicines(tenant.client, [{ name: medicineName, strength: "10 mg", selling_price: "10.00" }]);
    return seedStore(tenant, storeName);
  }

  async function signOut(page: Page) {
    await page.getByRole("button", { name: "Sign out" }).click();
    // with orders waiting on the phone the app warns first and the supplier signs out anyway (the orders stay on the phone)
    const anyway = page.getByTestId("sign-out-anyway");
    if (await anyway.isVisible().catch(() => false)) await anyway.click();
    await page.waitForURL((url) => url.pathname.startsWith("/sign-in"));
  }

  test("business B sees none of A's lists, orders or waiting items and sends none of them; A still has them and they arrive under A", async ({ page, context, freshTenant: a }) => {
    const b = await createTenant("e2e-b");
    try {
      await seed(a, "Alpha Store", "Alpha Med");
      await seed(b, "Beta Store", "Beta Med");

      // A takes an order offline
      await signIn(page, a);
      await waitDeviceReady(page);
      await goOffline(context);
      await page.goto("/orders/new");
      await page.getByTestId("store-option").filter({ hasText: "Alpha Store" }).first().click();
      await page.getByTestId("fast-search").fill("Alpha Med");
      await page.getByTestId("medicine-result").first().click();
      await page.getByTestId("fast-quantity").press("Enter");
      await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "on_device");

      // back online, but sending is cut, so the order stays on the phone while A signs out
      const putsAfterSignOut: string[] = [];
      let recording = false;
      await context.route(/\/api\/orders\/[0-9a-f-]{36}$/, async (route) => {
        if (route.request().method() === "PUT") {
          if (recording) putsAfterSignOut.push(route.request().url());
          return route.abort("connectionreset");
        }
        return route.continue();
      });
      await goOnline(context);
      await page.goto("/orders");
      await expect(page.getByTestId("device-order")).toHaveCount(1);
      await signOut(page);

      // B signs in on the same phone
      recording = true;
      await signIn(page, b);
      await waitDeviceReady(page);
      await page.goto("/orders");
      await expect(page.getByTestId("device-order")).toHaveCount(0);
      await expect(page.getByText("Alpha Store")).toHaveCount(0);
      await expect(page.getByTestId("sync-indicator")).toContainText("Online");
      await page.goto("/orders/new");
      await expect(page.getByTestId("store-option").filter({ hasText: "Beta Store" })).toHaveCount(1);
      await expect(page.getByTestId("store-option").filter({ hasText: "Alpha Store" })).toHaveCount(0);
      await page.waitForTimeout(3_000);
      expect(putsAfterSignOut).toEqual([]); // nothing of A was sent under B
      expect(await countOrders(a)).toBe(0);
      expect(await countOrders(b)).toBe(0);

      // B signs out, A signs in again: the order is still there and is sent under A
      await signOut(page);
      await context.unroute(/\/api\/orders\/[0-9a-f-]{36}$/);
      await signIn(page, a);
      await page.goto("/orders");
      await expect.poll(() => countOrders(a), { timeout: 60_000 }).toBe(1);
      expect(await countOrders(b)).toBe(0);
    } finally {
      await deleteTenant(b);
    }
  });

  test("offline, with no sign-in cookie the shell shows no orders and asks to sign in, and the data stays on the phone for the same user", async ({ page, context, freshTenant: a }) => {
    await seed(a, "Alpha Store", "Alpha Med");
    await signIn(page, a);
    await waitDeviceReady(page);
    await goOffline(context);
    const cookies = await context.cookies();
    await context.clearCookies();
    await page.goto("/orders");
    await expect(page.getByTestId("offline-needs-sign-in")).toContainText("Sign in to see this device's orders");
    await expect(page.getByText("Alpha Store")).toHaveCount(0);
    // the same user's cookie again: the phone's own data opens
    await context.addCookies(cookies);
    await page.goto("/orders/new");
    await expect(page.getByTestId("store-option").filter({ hasText: "Alpha Store" })).toHaveCount(1);
  });
});
