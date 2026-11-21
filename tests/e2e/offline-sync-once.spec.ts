import type { Page, Route } from "@playwright/test";
import { insertMedicines } from "../helpers/fast";
import { countOrders, goOffline, goOnline, linesOnServer, ordersOnServer, waitDeviceReady } from "../helpers/offline";
import { serviceClient, type TestTenant } from "../helpers/supabase-test";
import { seedStore } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US2 of Module 009: the orders reach the server by themselves, exactly once, however the connection behaves (mobile, 360 px).
test.describe("US2: the order reaches the server by itself, exactly once", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(180_000);

  async function seed(tenant: TestTenant) {
    const ids = await insertMedicines(tenant.client, [
      { name: "Sync Med One", strength: "10 mg", selling_price: "10.00" },
      { name: "Sync Med Two", strength: "20 mg", selling_price: "10.00" },
      { name: "Sync Med Three", strength: "30 mg", selling_price: "10.00" },
    ]);
    const storeId = await seedStore(tenant, "Sync Store");
    return { ids, storeId };
  }

  async function takeOfflineOrder(page: Page, medicineName: string, typed: string) {
    await page.goto("/orders/new");
    await page.getByTestId("store-option").filter({ hasText: "Sync Store" }).first().click();
    await expect(page.getByTestId("order-store")).toContainText("Sync Store");
    const box = page.getByTestId("fast-search");
    await box.fill(medicineName);
    await page.getByTestId("medicine-result").filter({ hasText: medicineName }).first().click();
    await page.getByTestId("fast-quantity").fill("3");
    await page.getByTestId("fast-quantity").press("Enter");
    await box.fill(typed);
    await page.getByTestId("add-as-typed").click();
    const form = page.getByTestId("typed-form");
    await form.getByLabel("Quantity").fill("2");
    await form.getByLabel("Unit").fill("box");
    await form.getByTestId("add-typed-line").click();
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "on_device");
  }

  test("three orders made offline arrive once each with their exact lines, even when responses are lost and requests are cut", async ({ page, context, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);

    await takeOfflineOrder(page, "Sync Med One", "Typed A");
    await takeOfflineOrder(page, "Sync Med Two", "Typed B");
    await takeOfflineOrder(page, "Sync Med Three", "Typed C");
    expect(await countOrders(freshTenant)).toBe(0);

    // the orders are listed with their own honest state
    await page.goto("/orders");
    await expect(page.getByTestId("device-order")).toHaveCount(3);
    for (const state of await page.getByTestId("draft-state").all()) await expect(state).toContainText("Saved on this device, not yet sent");

    // back online, but every request is held: nothing is "synced" or "saved" while the server has not answered
    const gate: { open: () => void; wait: Promise<void> } = (() => {
      let open!: () => void;
      const wait = new Promise<void>((r) => (open = r));
      return { open, wait };
    })();
    const seenRequestIds: string[] = [];
    let applied = 0;
    let cut = 0;
    await context.route(/\/api\/orders\/[0-9a-f-]{36}$/, async (route: Route) => {
      if (route.request().method() !== "PUT") return route.continue();
      await gate.wait;
      const id = (route.request().postDataJSON() as { request_id: string }).request_id;
      if (!seenRequestIds.includes(id)) seenRequestIds.push(id);
      if (cut < 1) {
        cut += 1;
        return route.abort("connectionreset"); // cut before the server saw it
      }
      if (applied < 3) {
        applied += 1;
        await route.fetch(); // the server applies it ...
        return route.abort("connectionreset"); // ... but the answer is lost
      }
      return route.continue();
    });
    await goOnline(context);
    await expect(page.getByTestId("sync-indicator")).not.toContainText("Offline", { timeout: 20_000 });
    await expect(page.getByTestId("sync-indicator")).toContainText(/Sending|waiting/);
    expect(await countOrders(freshTenant)).toBe(0);
    await expect(page.getByText(/Synced|Saved at/)).toHaveCount(0);

    gate.open();
    // all three arrive, once each
    await expect.poll(() => countOrders(freshTenant), { timeout: 90_000 }).toBe(3);
    await expect(page.getByTestId("device-order")).toHaveCount(0, { timeout: 90_000 });
    await expect(page.getByTestId("sync-indicator")).toContainText("Online");
    const orders = await ordersOnServer(freshTenant);
    expect(orders).toHaveLength(3);
    const expected = [
      ["Sync Med One", "Typed A"],
      ["Sync Med Two", "Typed B"],
      ["Sync Med Three", "Typed C"],
    ];
    const names: string[][] = [];
    for (const o of orders) names.push((await linesOnServer(o.id)).map((l) => l.name));
    expect(names).toEqual(expected);
    for (const o of orders) expect((await linesOnServer(o.id))[0]).toMatchObject({ quantity: 3 });
    // the lost responses were repeated with the SAME request ids: three distinct ids were applied once each
    expect(new Set(seenRequestIds).size).toBe(3);
  });

  test("an order the server refuses shows its reason and a Retry, stays on the phone untouched, and the other orders still arrive", async ({ page, context, freshTenant }) => {
    const { ids } = await seed(freshTenant);
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await takeOfflineOrder(page, "Sync Med One", "Typed A");
    await takeOfflineOrder(page, "Sync Med Two", "Typed B");
    // while the phone was offline the first medicine was made inactive on the server
    await serviceClient().from("products").update({ is_active: false }).eq("id", ids[0]!);
    await goOnline(context);

    await page.goto("/orders");
    await expect.poll(() => countOrders(freshTenant), { timeout: 60_000 }).toBe(1);
    const failed = page.getByTestId("device-order").filter({ has: page.locator('[data-state="failed"]') });
    await expect(failed).toHaveCount(1, { timeout: 30_000 });
    await expect(failed).toContainText(/inactive|no longer/i);
    await expect(failed.getByTestId("sync-retry")).toBeVisible();
    expect(await countOrders(freshTenant)).toBe(1);

    // make the medicine active again and tap Retry: the held order is sent, once
    await serviceClient().from("products").update({ is_active: true }).eq("id", ids[0]!);
    await failed.getByTestId("sync-retry").click();
    await expect.poll(() => countOrders(freshTenant), { timeout: 60_000 }).toBe(2);
    await expect(page.getByTestId("device-order")).toHaveCount(0, { timeout: 30_000 });
  });

  test("a hanging server never blocks typing, search or a new order, and the waiting order shows that it is sending", async ({ page, context, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await takeOfflineOrder(page, "Sync Med One", "Typed A");

    // the server accepts the connection but never answers an order save
    await context.route(/\/api\/orders\/[0-9a-f-]{36}$/, async (route) => {
      if (route.request().method() === "PUT") return; // held forever
      return route.continue();
    });
    await goOnline(context);
    await page.goto("/orders");
    await expect(page.getByTestId("draft-state").first()).toContainText("Sending", { timeout: 30_000 });

    // meanwhile a new order can be taken: typing and search stay fast
    await page.goto("/orders/new");
    await page.getByTestId("store-option").filter({ hasText: "Sync Store" }).first().click();
    await expect(page.getByTestId("fast-search")).toBeVisible();
    const started = Date.now();
    await page.getByTestId("fast-search").fill("Sync Med Two");
    await expect(page.getByTestId("medicine-result").first()).toBeVisible();
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await countOrders(freshTenant)).toBe(0);
  });
});
