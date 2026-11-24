import type { Page } from "@playwright/test";
import { insertMedicines } from "../helpers/fast";
import { countOrders, goOffline, readJournal, waitDeviceReady } from "../helpers/offline";
import type { TestTenant } from "../helpers/supabase-test";
import { createOrder, line, seedStore } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US1 of Module 009: take an order with no internet (mobile, 360 px). The browser is really offline: requests of the page and of
// the service worker fail, so what works here works on a phone without a signal.
test.describe("US1: take an order with no internet", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  const NAMES = Array.from({ length: 12 }, (_, i) => `Offline Med ${String(i + 1).padStart(2, "0")}`);

  async function seed(tenant: TestTenant): Promise<{ storeId: string; medicineIds: string[] }> {
    const medicineIds = await insertMedicines(
      tenant.client,
      NAMES.map((name, i) => ({ name, strength: `${(i + 1) * 10} mg`, dosage_form: "tablet", pack_size: "10", manufacturer: "Acme", selling_price: "10.00" })),
    );
    const storeId = await seedStore(tenant, "Offline Store");
    // an earlier confirmed order of four lines: the store's usual medicines and its last order
    await createOrder(
      tenant,
      storeId,
      [0, 1, 2, 3].map((i) => ({ product_id: medicineIds[i]!, quantity: 3 + i, unit: "strip" })),
      { confirm: true },
    );
    return { storeId, medicineIds };
  }

  async function addBySearch(page: Page, name: string) {
    const box = page.getByTestId("fast-search");
    await box.fill(name);
    await page.getByTestId("medicine-result").filter({ hasText: name }).first().click();
    await page.getByTestId("fast-quantity").press("Enter");
    await expect(box).toHaveValue("");
  }

  test("a ten-line order (repeated and searched) taken offline survives a reload and a new page, is never called saved or synced, and nothing reaches the server", async ({ page, context, freshTenant }) => {
    const { storeId } = await seed(freshTenant);
    await signIn(page, freshTenant);
    await waitDeviceReady(page, { storeExtras: [storeId] });

    const apiSuccesses: string[] = [];
    await goOffline(context);
    page.on("response", (response) => {
      if (response.url().includes("/api/") && response.ok()) apiSuccesses.push(response.url());
    });

    // the app opens offline (the service worker answers the page request with the offline shell)
    await page.goto("/orders/new");
    await expect(page.getByTestId("sync-indicator")).toContainText("Offline");
    await page.getByTestId("store-option").filter({ hasText: "Offline Store" }).first().click();
    await expect(page.getByTestId("order-store")).toContainText("Offline Store");

    // Repeat last order (four lines from the copy on this phone), then six medicines by search
    await expect(page.getByTestId("repeat-last-order")).toBeVisible();
    await page.getByTestId("repeat-last-order").click();
    await expect(page.getByTestId("order-line")).toHaveCount(4);
    for (const name of NAMES.slice(4, 10)) await addBySearch(page, name);
    await expect(page.getByTestId("order-line")).toHaveCount(10);

    // kept on this device, never called saved or synced
    const status = page.getByTestId("save-status");
    await expect(status).toHaveAttribute("data-state", "on_device");
    await expect(status).toContainText("Saved on this device, not yet sent");
    await expect(status).not.toContainText(/Synced|Saved at/);
    await expect(page.getByTestId("confirm-order")).toBeDisabled();
    await expect(page.getByTestId("confirm-needs-internet")).toBeVisible();
    const journal = await readJournal(page);
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ syncState: "on_device", neverSent: true });
    expect((journal[0]!.state as { lines: unknown[] }).lines).toHaveLength(10);

    // a reload while still offline keeps every line
    await page.reload();
    await expect(page.getByTestId("order-line")).toHaveCount(10);
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "on_device");
    for (let i = 0; i < 4; i += 1) await expect(line(page, i).getByLabel("Quantity")).toHaveValue(String(3 + i));

    // a fresh page of the same browser (the app was closed and opened again): the order is listed and opens with its lines
    const second = await context.newPage();
    await second.goto("/orders");
    await expect(second.getByTestId("offline-orders-note")).toBeVisible();
    await expect(second.getByTestId("device-order")).toHaveCount(1);
    await expect(second.getByTestId("draft-state")).toContainText("Saved on this device, not yet sent");
    await second.getByTestId("order-list-item").click();
    await expect(second.getByTestId("order-line")).toHaveCount(10);

    // nothing reached the server, and no request to the API succeeded while offline
    expect(await countOrders(freshTenant)).toBe(1); // only the earlier confirmed order
    expect(apiSuccesses).toEqual([]);
  });

  test("usual medicines and the last-order checklist work offline for a store whose data was saved on the phone", async ({ page, context, freshTenant }) => {
    const { storeId } = await seed(freshTenant);
    await signIn(page, freshTenant);
    await waitDeviceReady(page, { storeExtras: [storeId] });
    await goOffline(context);
    await page.goto("/orders/new");
    await page.getByTestId("store-option").filter({ hasText: "Offline Store" }).first().click();

    await expect(page.getByTestId("usual-card").first()).toBeVisible();
    await page.getByTestId("usual-card").first().getByTestId("usual-add").click();
    await expect(page.getByTestId("order-line")).toHaveCount(1);

    await expect(page.getByTestId("checklist-source")).toContainText("4 lines");
    await page.getByTestId("checklist-open").click();
    await page.getByTestId("checklist-row").nth(1).getByTestId("checklist-toggle").click();
    await page.getByTestId("checklist-add").click();
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "on_device");
  });

  test("a draft that already exists on the server, opened online and never edited, can be edited offline", async ({ page, context, freshTenant }) => {
    const { storeId, medicineIds } = await seed(freshTenant);
    const draft = await createOrder(freshTenant, storeId, [{ product_id: medicineIds[5]!, quantity: 2, unit: "strip" }]);
    await signIn(page, freshTenant);
    await page.goto(`/orders/${draft.id}`);
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await waitDeviceReady(page, { storeExtras: [storeId] });

    await goOffline(context);
    await page.reload(); // answered by the offline shell, the draft comes from the copy kept when it was opened
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await addBySearch(page, NAMES[6]!);
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "on_device");
    const journal = await readJournal(page);
    expect(journal.find((d) => d.orderId === draft.id)).toMatchObject({ baseVersion: draft.version, neverSent: false, syncState: "on_device" });
  });
});
