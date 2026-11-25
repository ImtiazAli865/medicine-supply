import { goOffline, goOnline, idbCount, waitDeviceReady } from "../helpers/offline";
import { accountArgs } from "../helpers/accounts";
import { serviceClient } from "../helpers/supabase-test";
import { accountStore, TODAY } from "./account-helpers";
import { expect, signIn, test } from "./fixtures";
import { paymentsOnServer, readPaymentOps, recordOnPhone, savePhonePayment } from "./payment-helpers";

// Module 011, US2: a payment the server refuses is kept on the phone, shown with its reason in the sync status, never dropped,
// never sent by itself again, and the supplier decides (mobile, 360 px).
test.describe("US2: payments the server refuses", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(180_000);

  test("a payment for a store that is not on the server is a conflict: kept, with its reason, removed only after a question", async ({ page, context, freshTenant }) => {
    const store = await accountStore(freshTenant, "Vanishing Store");
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await recordOnPhone(page, "Vanishing Store", ["900"]);
    // the store is removed on the server meanwhile (test only, with the service role)
    const removed = await serviceClient().from("stores").delete().eq("id", store.id);
    expect(removed.error).toBeNull();

    await goOnline(context);
    await expect.poll(async () => (await readPaymentOps(page))[0]?.state, { timeout: 60_000 }).toBe("conflict");
    await page.goto("/settings");
    const card = page.getByTestId("device-payment");
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute("data-state", "conflict");
    await expect(card).toContainText("PKR 900.00");
    await expect(page.getByTestId("device-payment-reason")).toHaveText("This store is not on the server.");
    await expect(page.getByTestId("device-payment-kept")).toContainText("stays on this phone until you decide");
    await expect(page.getByTestId("sync-counts")).toContainText("1 need a decision");
    await expect(page.getByTestId("sync-indicator")).toContainText("1 needs a decision");
    // nothing was recorded anywhere, and it is not sent again by itself
    expect(await paymentsOnServer(store.id)).toHaveLength(0);
    await page.waitForTimeout(5_000);
    expect(await idbCount(page, "paymentOps")).toBe(1);

    // Remove asks first; saying no keeps it
    await page.getByTestId("device-payment-remove").click();
    await expect(page.getByTestId("device-payment-confirm")).toContainText("PKR 900.00");
    await page.getByTestId("device-payment-remove-cancel").click();
    await expect(page.getByTestId("device-payment")).toHaveCount(1);
    expect(await idbCount(page, "paymentOps")).toBe(1);
    // the correction form is only for a refused detail, never for a missing store
    await expect(page.getByTestId("device-payment-correct-open")).toHaveCount(0);
    // saying yes removes exactly this one
    await page.getByTestId("device-payment-remove").click();
    await page.getByTestId("device-payment-remove-confirm").click();
    await expect(page.getByTestId("device-payment")).toHaveCount(0);
    expect(await idbCount(page, "paymentOps")).toBe(0);
  });

  test("a payment key that already holds other details shows that reason and offers no edit", async ({ page, context, freshTenant }) => {
    const store = await accountStore(freshTenant, "Reused Key Store");
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await recordOnPhone(page, "Reused Key Store", ["500"]);
    const [phone] = await readPaymentOps(page);
    // the same key is used on the server for another amount (test only, through the business's own client)
    const forced = await freshTenant.client.rpc("ledger_payment_add", accountPaymentArgs(phone!.paymentId, store.id, "777.00"));
    expect(forced.data?.done).toBe(true);

    await goOnline(context);
    await expect.poll(async () => (await readPaymentOps(page))[0]?.state, { timeout: 60_000 }).toBe("conflict");
    await page.goto("/settings");
    await expect(page.getByTestId("device-payment-reason")).toHaveText("A payment with this key but other details already exists. Check the store's account.");
    await expect(page.getByTestId("device-payment-correct-open")).toHaveCount(0);
    // the server still holds exactly the one entry it had, with its own amount
    const entries = await paymentsOnServer(store.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.credit).toBe("777.00");
  });

  test("a payment the server refuses for its date can be corrected and is then recorded once, with the same key", async ({ page, context, freshTenant }) => {
    const store = await accountStore(freshTenant, "Wrong Clock Store");
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await page.goto("/offline");
    await page.getByTestId("offline-record-payment").click();
    await expect(page.getByTestId("payment-store")).toBeVisible();
    // The phone's clock is a day ahead while the payment is saved, so "today" on the phone is tomorrow on the server.
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
    await savePhonePayment(page, { store: "Wrong Clock Store", amount: "400", date: tomorrow, reference: "R5" });
    await page.evaluate(() => {
      window.Date = (window as unknown as { __RealDate: DateConstructor }).__RealDate;
    });
    const [phone] = await readPaymentOps(page);

    await goOnline(context);
    await expect.poll(async () => (await readPaymentOps(page))[0]?.state, { timeout: 60_000 }).toBe("conflict");
    await page.goto("/settings");
    const card = page.getByTestId("device-payment");
    await expect(card).toHaveAttribute("data-state", "conflict");
    await expect(page.getByTestId("device-payment-reason")).toContainText("date");
    expect(await paymentsOnServer(store.id)).toHaveLength(0);

    await page.getByTestId("device-payment-correct-open").click();
    await page.getByTestId("device-payment-fix-date").fill(TODAY);
    await page.getByTestId("device-payment-fix-send").click();
    await expect.poll(() => idbCount(page, "paymentOps"), { timeout: 60_000 }).toBe(0);
    const entries = await paymentsOnServer(store.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: phone!.paymentId, credit: "400.00", entry_date: TODAY, reference: "R5" });
  });
});

function accountPaymentArgs(id: string, storeId: string, amount: string) {
  return accountArgs.payment(id, storeId, amount, TODAY);
}
