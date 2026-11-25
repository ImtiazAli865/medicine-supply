import type { Page } from "@playwright/test";
import { goOffline, goOnline, waitDeviceReady } from "../helpers/offline";
import { serviceClient } from "../helpers/supabase-test";
import { accountStore, addOpening, openAccount } from "./account-helpers";
import { expect, signIn, smallTargets, test } from "./fixtures";
import { openPaymentScreen, readPaymentOps, savePhonePayment } from "./payment-helpers";

// Module 011 (SC-010): every control of the payment screens is at least 44 x 44 px at 360 px, nothing scrolls sideways, and the
// bottom navigation keeps five items.
test.describe("Module 011: 360 px touch targets of the payment screens", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(240_000);

  async function check(page: Page, label: string) {
    expect(await smallTargets(page), `small targets on ${label}`).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `sideways scroll on ${label}`).toBeLessThanOrEqual(0);
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(5);
  }

  test("the offline home, the Record payment screen, a waiting payment, the remove question, a payment in conflict and the account notes", async ({ page, context, freshTenant }) => {
    const store = await accountStore(freshTenant, "Target Pay Store");
    const gone = await accountStore(freshTenant, "Target Gone Store");
    await addOpening(freshTenant, store.id, "5000.00", "owes");
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);

    await page.goto("/offline");
    await expect(page.getByTestId("offline-record-payment")).toBeVisible();
    await check(page, "the offline home");
    await openPaymentScreen(page);
    await check(page, "the Record payment screen");
    await savePhonePayment(page, { store: "Target Pay Store", amount: "1200", reference: "Receipt 99" });
    await check(page, "the Record payment screen with a waiting payment");
    await page.getByTestId("device-payment-remove").click();
    await expect(page.getByTestId("device-payment-confirm")).toBeVisible();
    await check(page, "the question before a payment is removed");
    await page.getByTestId("device-payment-remove-cancel").click();
    await savePhonePayment(page, { store: "Target Gone Store", amount: "30" });

    // The server cannot be reached for the first payment, so it stays waiting while its notes are shown; the other store is gone.
    await context.route(/\/api\/accounts\/[0-9a-f-]{36}\/payments$/, (route) => (route.request().url().includes(store.id) ? route.abort("connectionreset") : route.continue()));
    const removed = await serviceClient().from("stores").delete().eq("id", gone.id);
    expect(removed.error).toBeNull();
    await goOnline(context);
    await expect.poll(async () => (await readPaymentOps(page)).find((p) => p.storeId === gone.id)?.state, { timeout: 60_000 }).toBe("conflict");

    await page.goto("/settings");
    await expect(page.getByTestId("device-payment")).toHaveCount(2);
    await check(page, "Settings with a waiting payment and a payment in conflict");
    await openAccount(page, store.id);
    await expect(page.getByTestId("pending-sync-note")).toBeVisible();
    await check(page, "the account screen with the pending sync note");
    await page.goto("/accounts");
    await expect(page.getByTestId("account-item-pending")).toBeVisible();
    await check(page, "the store accounts list with the pending sync note");
    await page.goto("/");
    await expect(page.getByTestId("accounts-pending-note")).toBeVisible();
    await check(page, "Home with the pending sync note");
  });

  test("a payment the server refused for its date: the conflict card and its correct-and-resend form", async ({ page, context, freshTenant }) => {
    await accountStore(freshTenant, "Target Clock Store");
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await openPaymentScreen(page);
    // The phone's clock is a day ahead while the payment is saved, so the server refuses its date later.
    const tomorrow = new Date(Date.now() + 86_400_000 + 5 * 3_600_000).toISOString().slice(0, 10);
    await page.evaluate(() => {
      const Real = Date;
      (window as unknown as { __RealDate: DateConstructor }).__RealDate = Real;
      class Ahead extends Real {
        constructor(...args: unknown[]) {
          if (args.length === 0) super(Real.now() + 86_400_000);
          else super(...(args as [number]));
        }
        static now() {
          return Real.now() + 86_400_000;
        }
      }
      window.Date = Ahead as unknown as DateConstructor;
    });
    await savePhonePayment(page, { store: "Target Clock Store", amount: "40", date: tomorrow });
    await page.evaluate(() => {
      window.Date = (window as unknown as { __RealDate: DateConstructor }).__RealDate;
    });
    await goOnline(context);
    await expect.poll(async () => (await readPaymentOps(page))[0]?.state, { timeout: 60_000 }).toBe("conflict");
    await page.goto("/settings");
    await expect(page.getByTestId("device-payment")).toHaveAttribute("data-state", "conflict");
    await check(page, "Settings with a refused payment");
    await page.getByTestId("device-payment-correct-open").click();
    await expect(page.getByTestId("device-payment-correct")).toBeVisible();
    await check(page, "the correct-and-resend form");
  });
});
