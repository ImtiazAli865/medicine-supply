import { goOffline, goOnline, idbCount, waitDeviceReady } from "../helpers/offline";
import { accountStore, addOpening, balanceOfStore, openAccount } from "./account-helpers";
import { expect, signIn, test } from "./fixtures";
import { paymentsOnServer, readPaymentOps, recordOnPhone } from "./payment-helpers";

// Module 011, US2: the payments kept on the phone are sent once each, in order, and the server holds exactly one entry for
// each, whatever goes wrong on the way (mobile, 360 px).
test.describe("US2: sending the payments kept on the phone", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(180_000);

  test("three payments recorded offline are sent once, in order; the account shows three entries and the right balance", async ({ page, context, freshTenant }) => {
    const store = await accountStore(freshTenant, "Send Store");
    await addOpening(freshTenant, store.id, "10000.00", "owes");
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await recordOnPhone(page, "Send Store", ["1000", "2000", "3000"]);
    expect(await idbCount(page, "paymentOps")).toBe(3);
    expect(await paymentsOnServer(store.id)).toHaveLength(0);

    await goOnline(context);
    await expect.poll(() => idbCount(page, "paymentOps"), { timeout: 60_000 }).toBe(0);
    const entries = await paymentsOnServer(store.id);
    expect(entries.map((e) => e.credit)).toEqual(["1000.00", "2000.00", "3000.00"]);
    expect(new Set(entries.map((e) => e.id)).size).toBe(3);
    expect(await balanceOfStore(freshTenant, store.id)).toBe("4000.00");

    await openAccount(page, store.id);
    await expect(page.getByTestId("account-balance")).toHaveText("Owes PKR 4,000.00");
    await expect(page.getByTestId("entry-row").filter({ hasText: "Payment" })).toHaveCount(3);
    await expect(page.getByTestId("pending-sync-note")).toHaveCount(0);
    await expect(page.getByTestId("balance-pending-sync")).toHaveCount(0);
  });

  test("a lost answer is sent again with the same key and the server still holds one entry", async ({ page, context, freshTenant }) => {
    const store = await accountStore(freshTenant, "Lost Answer Store");
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await recordOnPhone(page, "Lost Answer Store", ["750"]);
    const [phone] = await readPaymentOps(page);

    // The first request reaches the server, but its answer never comes back.
    const seen: string[] = [];
    let lostOne = false;
    await context.route(/\/api\/accounts\/[0-9a-f-]{36}\/payments$/, async (route) => {
      seen.push(JSON.parse(route.request().postData() ?? "{}").id);
      if (!lostOne) {
        lostOne = true;
        await route.fetch(); // the server records it
        return route.abort("connectionreset"); // the phone never hears
      }
      return route.continue();
    });
    await goOnline(context);
    await expect.poll(() => idbCount(page, "paymentOps"), { timeout: 90_000 }).toBe(0);
    expect(lostOne).toBe(true);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seen)).toEqual(new Set([phone!.paymentId])); // the same key every time
    const entries = await paymentsOnServer(store.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: phone!.paymentId, credit: "750.00" });
    expect(await balanceOfStore(freshTenant, store.id)).toBe("-750.00");
  });

  test("two tabs of the same phone give exactly one entry for each payment", async ({ page, context, freshTenant }) => {
    const store = await accountStore(freshTenant, "Two Tabs Store");
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await recordOnPhone(page, "Two Tabs Store", ["100", "200"]);
    const second = await context.newPage();
    await second.goto("/offline");
    await expect(second.getByTestId("offline-record-payment")).toBeVisible();
    await goOnline(context);
    await expect.poll(() => idbCount(page, "paymentOps"), { timeout: 90_000 }).toBe(0);
    await second.waitForTimeout(3_000);
    const entries = await paymentsOnServer(store.id);
    expect(entries.map((e) => e.credit)).toEqual(["100.00", "200.00"]);
    expect(await idbCount(second, "paymentOps")).toBe(0);
  });

  test("a reload while a payment is being sent keeps it, and it is recorded once", async ({ page, context, freshTenant }) => {
    const store = await accountStore(freshTenant, "Reload Store");
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await recordOnPhone(page, "Reload Store", ["500"]);
    let held = true;
    await context.route(/\/api\/accounts\/[0-9a-f-]{36}\/payments$/, async (route) => {
      if (held) {
        // forward it (the server records it) but keep the answer for a long time
        await route.fetch();
        await new Promise((resolve) => setTimeout(resolve, 8_000));
        return route.abort("connectionreset").catch(() => undefined);
      }
      return route.continue();
    });
    await goOnline(context);
    await expect.poll(async () => (await readPaymentOps(page))[0]?.attempted ?? false, { timeout: 60_000 }).toBe(true);
    await page.reload();
    held = false;
    expect((await readPaymentOps(page)).length).toBe(1);
    await expect.poll(() => idbCount(page, "paymentOps"), { timeout: 90_000 }).toBe(0);
    expect(await paymentsOnServer(store.id)).toHaveLength(1);
  });
});
