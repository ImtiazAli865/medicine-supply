import type { Page } from "@playwright/test";
import { goOffline, goOnline, waitDeviceReady } from "../helpers/offline";
import { createTenant, deleteTenant } from "../helpers/supabase-test";
import { accountStore } from "./account-helpers";
import { expect, signIn, test } from "./fixtures";
import { paymentsOnServer, recordOnPhone } from "./payment-helpers";

// Module 011, US2 (SC-005 for payments): two businesses on one phone never see or send each other's waiting payments, and
// signing out with a waiting payment is protected (mobile, 360 px).
test.describe("US2: waiting payments of two businesses on one phone", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(240_000);

  async function signOut(page: Page) {
    await page.getByRole("button", { name: "Sign out" }).click();
    const anyway = page.getByTestId("sign-out-anyway");
    if (await anyway.isVisible().catch(() => false)) await anyway.click();
    await page.waitForURL((url) => url.pathname.startsWith("/sign-in"));
  }

  test("business B never sees or sends a waiting payment of A; A still has it and it arrives under A", async ({ page, context, freshTenant: a }) => {
    const b = await createTenant("e2e-b");
    try {
      const storeA = await accountStore(a, "Alpha Payer");
      await accountStore(b, "Beta Payer");

      await signIn(page, a);
      await waitDeviceReady(page);
      await goOffline(context);
      await recordOnPhone(page, "Alpha Payer", ["1500"]);

      // Back online, but sending is cut, so the payment stays on the phone while A signs out
      const sentAfterSignOut: string[] = [];
      let recording = false;
      await context.route(/\/api\/accounts\/[0-9a-f-]{36}\/payments$/, (route) => {
        if (recording) sentAfterSignOut.push(route.request().url());
        return route.abort("connectionreset");
      });
      await goOnline(context);
      await page.goto("/settings");
      await expect(page.getByTestId("device-payment")).toHaveCount(1);
      // Signing out with a payment waiting asks first and names the payment
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page.getByTestId("sign-out-warning")).toContainText("1 payment is kept on this phone and not on the server yet");
      await page.getByRole("button", { name: "Stay signed in" }).click();
      await signOut(page);

      // B signs in on the same phone
      recording = true;
      await signIn(page, b);
      await waitDeviceReady(page);
      await page.goto("/settings");
      await expect(page.getByTestId("device-payment")).toHaveCount(0);
      await expect(page.getByText("Alpha Payer")).toHaveCount(0);
      await expect(page.getByTestId("sync-indicator")).toContainText("Online");
      // B's own lists are copied to the phone (the shared helper looks at the first database of the phone, which is A's)
      await expect
        .poll(
          () =>
            page.evaluate(async (businessId) => {
              const db: IDBDatabase = await new Promise((resolve, reject) => {
                const req = indexedDB.open(`medsupply-${businessId}`);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
              });
              try {
                if (!db.objectStoreNames.contains("stores")) return [];
                return await new Promise<string[]>((resolve) => {
                  const req = db.transaction("stores", "readonly").objectStore("stores").getAll();
                  req.onsuccess = () => resolve((req.result as Array<{ name: string }>).map((x) => x.name));
                });
              } finally {
                db.close();
              }
            }, b.businessId!),
          { timeout: 60_000 },
        )
        .toEqual(["Beta Payer"]);
      await goOffline(context);
      await page.goto("/offline");
      await page.getByTestId("offline-record-payment").click();
      await expect(page.getByTestId("payment-store").locator("option")).toHaveText(["Choose a store", "Beta Payer"]);
      await goOnline(context);
      await page.waitForTimeout(3_000);
      expect(sentAfterSignOut).toEqual([]); // nothing of A was sent under B
      expect(await paymentsOnServer(storeA.id)).toHaveLength(0);

      // B signs out, A signs in again: the payment is still there and is sent under A
      await signOut(page);
      await context.unroute(/\/api\/accounts\/[0-9a-f-]{36}\/payments$/);
      await signIn(page, a);
      await waitDeviceReady(page);
      await expect.poll(async () => (await paymentsOnServer(storeA.id)).length, { timeout: 90_000 }).toBe(1);
      expect((await paymentsOnServer(storeA.id))[0]).toMatchObject({ credit: "1500.00" });
    } finally {
      await deleteTenant(b);
    }
  });
});
