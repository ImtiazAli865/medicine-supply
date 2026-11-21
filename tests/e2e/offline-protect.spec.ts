import { insertMedicines } from "../helpers/fast";
import { countOrders, goOffline, goOnline, readJournal, waitDeviceReady } from "../helpers/offline";
import type { TestTenant } from "../helpers/supabase-test";
import { seedStore } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US3 of Module 009: an order that exists only on the phone is never deleted or lost without the supplier knowing (mobile, 360 px).
test.describe("US3: protections", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(150_000);

  async function seed(tenant: TestTenant) {
    await insertMedicines(tenant.client, [
      { name: "Protect Med", strength: "10 mg", selling_price: "10.00" },
      { name: "Protect Other", strength: "20 mg", selling_price: "10.00" },
    ]);
    await seedStore(tenant, "Protect Store");
  }

  async function startOfflineOrder(page: import("@playwright/test").Page, context: Parameters<typeof goOffline>[0], tenant: TestTenant) {
    await signIn(page, tenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await page.goto("/orders/new");
    await page.getByTestId("store-option").filter({ hasText: "Protect Store" }).first().click();
    await page.getByTestId("fast-search").fill("Protect Med");
    await page.getByTestId("medicine-result").first().click();
    await page.getByTestId("fast-quantity").press("Enter");
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "on_device");
  }

  test("discarding an order that never reached the server asks first, says it will be lost, and keeps it when the supplier says no", async ({ page, context, freshTenant }) => {
    await seed(freshTenant);
    await startOfflineOrder(page, context, freshTenant);
    await page.getByTestId("discard-draft").click();
    await expect(page.getByTestId("discard-unsent-text")).toContainText("has not reached the server");
    await expect(page.getByTestId("discard-unsent-text")).toContainText("deleted from this phone");
    await page.getByRole("button", { name: "Keep the order" }).click();
    expect((await readJournal(page)).length).toBe(1);
    await expect(page.getByTestId("order-line")).toHaveCount(1);

    await page.getByTestId("discard-draft").click();
    await page.getByTestId("discard-unsent-confirm").click();
    // the screen leaves for the Orders list; read the journal again once the new page is ready
    await page.waitForURL(/offline\?go=%2Forders$|\/orders$/, { timeout: 30_000 });
    await expect(page.getByTestId("device-order")).toHaveCount(0);
    await expect.poll(async () => (await readJournal(page).catch(() => [{}])).length).toBe(0);
    expect(await countOrders(freshTenant)).toBe(0);
  });

  test("a session that expires keeps the waiting order and sends it after sign-in; nothing is lost", async ({ page, context, freshTenant }) => {
    await seed(freshTenant);
    await startOfflineOrder(page, context, freshTenant);
    await context.route(/\/api\/orders\/[0-9a-f-]{36}$/, (route) =>
      route.request().method() === "PUT" ? route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "unauthenticated", message: "Your session expired." }) }) : route.continue(),
    );
    await goOnline(context);
    await page.goto("/orders");
    await expect(page.getByTestId("sync-indicator")).toContainText("Sign in to send", { timeout: 30_000 });
    expect(page.url()).toContain("/orders"); // the person was not taken away from the screen
    expect((await readJournal(page)).length).toBe(1);
    expect(await countOrders(freshTenant)).toBe(0);

    await context.unroute(/\/api\/orders\/[0-9a-f-]{36}$/);
    await page.reload(); // the same user is signed in again (the session cookie is valid): sending resumes
    await expect.poll(() => countOrders(freshTenant), { timeout: 60_000 }).toBe(1);
  });

  test("the same draft changed in two tabs of the phone: the second change is refused as a conflict on the device and no edit is lost", async ({ page, context, freshTenant }) => {
    await seed(freshTenant);
    await startOfflineOrder(page, context, freshTenant);
    const url = page.url();
    const second = await context.newPage();
    await second.goto(url);
    await expect(second.getByTestId("order-line")).toHaveCount(1);

    // tab one adds a line and it is kept on the device
    await page.getByTestId("fast-search").fill("Protect Other");
    await page.getByTestId("medicine-result").first().click();
    await page.getByTestId("fast-quantity").press("Enter");
    await expect.poll(async () => ((await readJournal(page))[0]!.state as { lines: unknown[] }).lines.length).toBe(2);

    // tab two (which still shows one line) adds a different line: the journal refuses the stale write
    await second.getByTestId("fast-search").fill("Protect Other");
    await second.getByTestId("medicine-result").first().click();
    await second.getByTestId("fast-quantity").press("Enter");
    await expect(second.getByTestId("save-status")).toContainText("changed in another tab", { timeout: 15_000 });
    expect(((await readJournal(page))[0]!.state as { lines: unknown[] }).lines).toHaveLength(2); // tab one's edit is still there
  });
});
