import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { insertMedicines } from "../helpers/fast";
import { goOffline, goOnline, linesOnServer, ordersOnServer, readJournal, waitDeviceReady } from "../helpers/offline";
import { serviceClient, type TestTenant } from "../helpers/supabase-test";
import { createOrder, seedStore } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US3 of Module 009: nothing is lost and nothing is silently overwritten (mobile, 360 px). The phone version and the server
// version are shown side by side and nothing changes on either side until the supplier chooses.
test.describe("US3: conflicts", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(150_000);

  interface Seeded {
    storeId: string;
    ids: string[];
    orderId: string;
  }

  async function seed(tenant: TestTenant): Promise<Seeded> {
    const ids = await insertMedicines(tenant.client, [
      { name: "Conflict Med One", strength: "10 mg", selling_price: "10.00" },
      { name: "Conflict Med Two", strength: "20 mg", selling_price: "10.00" },
      { name: "Conflict Med Three", strength: "30 mg", selling_price: "10.00" },
    ]);
    const storeId = await seedStore(tenant, "Conflict Store");
    const order = await createOrder(tenant, storeId, [{ product_id: ids[0]!, quantity: 2, unit: "strip" }]);
    return { storeId, ids, orderId: order.id };
  }

  /** Replaces the lines of the server draft (as another device would), using the version it has now. */
  async function serverEdit(tenant: TestTenant, s: Seeded, productIds: string[]) {
    const { data: current } = await tenant.client.rpc("order_get", { p_id: s.orderId });
    const saved = await tenant.client.rpc("order_save", {
      p_id: s.orderId,
      p_request_id: randomUUID(),
      p_expected_version: current.version,
      p_store_id: s.storeId,
      p_notes: null,
      p_lines: productIds.map((p) => ({ id: randomUUID(), product_id: p, name: null, quantity: 5, unit: "strip" })),
    });
    expect(saved.data.saved).toBe(true);
    return saved.data.order.version as number;
  }

  /** Opens the draft online (so a copy is kept), goes offline, adds Med Two on the phone, then lets the server change meanwhile. */
  async function setup(page: Page, context: Parameters<typeof goOffline>[0], tenant: TestTenant, s: Seeded, serverChange: () => Promise<void>) {
    await signIn(page, tenant);
    await page.goto(`/orders/${s.orderId}`);
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await waitDeviceReady(page, { storeExtras: [s.storeId] });
    await goOffline(context);
    await page.reload();
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    const box = page.getByTestId("fast-search");
    await box.fill("Conflict Med Two");
    await page.getByTestId("medicine-result").filter({ hasText: "Conflict Med Two" }).first().click();
    await page.getByTestId("fast-quantity").press("Enter");
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "on_device");
    await serverChange(); // another device changes the same order meanwhile
    await goOnline(context);
  }

  const names = async (tenantOrderId: string) => (await linesOnServer(tenantOrderId)).map((l) => l.name);

  test("changed elsewhere: both versions are shown and nothing changes until the supplier chooses; keep the phone version replaces the server lines after a preview", async ({ page, context, freshTenant }) => {
    const s = await seed(freshTenant);
    await setup(page, context, freshTenant, s, async () => void (await serverEdit(freshTenant, s, [s.ids[0]!, s.ids[2]!])));

    const panel = page.getByTestId("conflict-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByTestId("conflict-phone")).toContainText("Conflict Med Two");
    await expect(panel.getByTestId("conflict-server")).toContainText("Conflict Med Three");
    // nothing changed on either side while the supplier has not chosen
    expect(await names(s.orderId)).toEqual(["Conflict Med One", "Conflict Med Three"]);
    expect((await readJournal(page)).find((d) => d.orderId === s.orderId)?.syncState).toBe("conflict");

    await panel.getByTestId("keep-phone").click();
    await expect(page.getByTestId("conflict-confirm-text")).toContainText("will be replaced");
    expect(await names(s.orderId)).toEqual(["Conflict Med One", "Conflict Med Three"]); // still untouched
    await page.getByTestId("conflict-confirm").click();
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved", { timeout: 30_000 });
    expect(await names(s.orderId)).toEqual(["Conflict Med One", "Conflict Med Two"]);
  });

  test("keep the server version deletes the phone changes only after a confirmation that says so", async ({ page, context, freshTenant }) => {
    const s = await seed(freshTenant);
    await setup(page, context, freshTenant, s, async () => void (await serverEdit(freshTenant, s, [s.ids[0]!, s.ids[2]!])));
    const panel = page.getByTestId("conflict-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await panel.getByTestId("keep-server").click();
    await expect(page.getByTestId("conflict-confirm-text")).toContainText("will be deleted from this phone");
    await expect(page.getByTestId("conflict-confirm-text")).toContainText("phone's changes will be lost");
    await page.getByTestId("conflict-confirm").click();
    await expect(page.getByTestId("conflict-panel")).toHaveCount(0);
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await expect(page.getByTestId("order-lines")).toContainText("Conflict Med Three");
    await expect(page.getByTestId("order-lines")).not.toContainText("Conflict Med Two");
    expect(await names(s.orderId)).toEqual(["Conflict Med One", "Conflict Med Three"]);
  });

  test("keep both makes the phone lines a new separate draft and leaves the server order as it is", async ({ page, context, freshTenant }) => {
    const s = await seed(freshTenant);
    await setup(page, context, freshTenant, s, async () => void (await serverEdit(freshTenant, s, [s.ids[0]!, s.ids[2]!])));
    const panel = page.getByTestId("conflict-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await panel.getByTestId("keep-both").click();
    await expect(page.getByTestId("conflict-confirm-text")).toContainText("new separate draft");
    await page.getByTestId("conflict-confirm").click();
    await expect.poll(async () => (await ordersOnServer(freshTenant)).length, { timeout: 60_000 }).toBe(2);
    expect(await names(s.orderId)).toEqual(["Conflict Med One", "Conflict Med Three"]);
    const orders = await ordersOnServer(freshTenant);
    const other = orders.find((o) => o.id !== s.orderId)!;
    expect(await names(other.id)).toEqual(["Conflict Med One", "Conflict Med Two"]);
  });

  test("confirmed elsewhere: no 'keep the phone version', the phone copy stays available, nothing is applied", async ({ page, context, freshTenant }) => {
    const s = await seed(freshTenant);
    await setup(page, context, freshTenant, s, async () => {
      const { data } = await freshTenant.client.rpc("order_get", { p_id: s.orderId });
      const confirmed = await freshTenant.client.rpc("order_confirm", { p_id: s.orderId, p_request_id: randomUUID(), p_expected_version: data.version });
      expect(confirmed.data.confirmed).toBe(true);
    });
    const panel = page.getByTestId("conflict-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByTestId("keep-phone")).toHaveCount(0);
    await expect(panel.getByTestId("keep-server")).toBeVisible();
    await expect(panel.getByTestId("keep-both")).toBeVisible();
    await expect(panel.getByTestId("conflict-phone")).toContainText("Conflict Med Two"); // the phone copy is still shown
    expect(await names(s.orderId)).toEqual(["Conflict Med One"]);
    expect((await readJournal(page)).find((d) => d.orderId === s.orderId)).toMatchObject({ syncState: "conflict" });
  });

  test("cancelled elsewhere is a conflict as well and is never applied silently", async ({ page, context, freshTenant }) => {
    const s = await seed(freshTenant);
    await setup(page, context, freshTenant, s, async () => {
      const { data } = await freshTenant.client.rpc("order_get", { p_id: s.orderId });
      const cancelled = await freshTenant.client.rpc("order_cancel", { p_id: s.orderId, p_request_id: randomUUID(), p_expected_version: data.version, p_reason: null });
      expect(cancelled.data.cancelled).toBe(true);
    });
    const panel = page.getByTestId("conflict-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByTestId("keep-phone")).toHaveCount(0);
    expect((await ordersOnServer(freshTenant)).find((o) => o.id === s.orderId)?.status).toBe("cancelled");
  });

  test("a medicine made inactive meanwhile holds the order with its name; nothing is dropped; the supplier chooses what to do", async ({ page, context, freshTenant }) => {
    const s = await seed(freshTenant);
    await signIn(page, freshTenant);
    await waitDeviceReady(page, { storeExtras: [s.storeId] });
    await goOffline(context);
    await page.goto("/orders/new");
    await page.getByTestId("store-option").filter({ hasText: "Conflict Store" }).first().click();
    for (const name of ["Conflict Med Two", "Conflict Med Three"]) {
      await page.getByTestId("fast-search").fill(name);
      await page.getByTestId("medicine-result").filter({ hasText: name }).first().click();
      await page.getByTestId("fast-quantity").press("Enter");
    }
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await serviceClient().from("products").update({ is_active: false }).eq("id", s.ids[1]!);
    await goOnline(context);

    const held = page.getByTestId("held-line");
    await expect(held).toBeVisible({ timeout: 30_000 });
    await expect(held).toContainText("Conflict Med Two");
    expect((await ordersOnServer(freshTenant)).length).toBe(1); // only the seeded draft: nothing was sent, nothing dropped
    await expect(page.getByTestId("order-line")).toHaveCount(2);

    // save it as a typed line: the exact name is kept and the order goes through
    await held.getByTestId("held-to-typed").click();
    await page.getByTestId("conflict-confirm").click();
    await expect.poll(async () => (await ordersOnServer(freshTenant)).length, { timeout: 60_000 }).toBe(2);
    const created = (await ordersOnServer(freshTenant)).find((o) => o.id !== s.orderId)!;
    const lines = await linesOnServer(created.id);
    expect(lines.map((l) => [l.name, l.product_id === null])).toEqual([
      ["Conflict Med Two", true],
      ["Conflict Med Three", false],
    ]);
  });

  test("a store made inactive meanwhile holds the order; it is never attached to another store", async ({ page, context, freshTenant }) => {
    const s = await seed(freshTenant);
    const otherStore = await seedStore(freshTenant, "Other Store");
    await signIn(page, freshTenant);
    await waitDeviceReady(page, { storeExtras: [s.storeId] });
    await goOffline(context);
    await page.goto("/orders/new");
    await page.getByTestId("store-option").filter({ hasText: "Conflict Store" }).first().click();
    await page.getByTestId("fast-search").fill("Conflict Med Two");
    await page.getByTestId("medicine-result").filter({ hasText: "Conflict Med Two" }).first().click();
    await page.getByTestId("fast-quantity").press("Enter");
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await serviceClient().from("stores").update({ is_active: false }).eq("id", s.storeId);
    await goOnline(context);
    await expect(page.getByTestId("held-store")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("held-store")).toContainText("Conflict Store");
    const orders = await ordersOnServer(freshTenant);
    expect(orders.every((o) => o.store_id !== otherStore)).toBe(true);
    expect(orders.length).toBe(1); // only the seeded draft
  });
});
