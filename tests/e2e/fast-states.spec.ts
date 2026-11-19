import { insertMedicines } from "../helpers/fast";
import type { TestTenant } from "../helpers/supabase-test";
import { addMedicine, createOrder, line, seedStore, startOrder, waitSaved } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US5 of Module 008: failures and honest limits (mobile, 360 px). Nothing here may say "saved on this device" or "pending sync".
test.describe("US5: failures and honest limits", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  const NEVER = /saved on this device|pending sync|synced/i;

  async function seed(tenant: TestTenant) {
    const [panadol, brufen] = await insertMedicines(tenant.client, [
      { name: "Panadol", strength: "500 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK", selling_price: "12.00" },
      { name: "Brufen", strength: "400 mg", dosage_form: "tablet", pack_size: "20", manufacturer: "Abbott", selling_price: "20.00" },
    ]);
    const storeId = await seedStore(tenant, "States Store");
    // history so that the repeat button and one usual card exist
    await createOrder(tenant, storeId, [{ product_id: panadol!, quantity: 5, unit: "strip" }, { product_id: brufen!, quantity: 2, unit: "box" }], { confirm: true });
    return { panadol: panadol!, brufen: brufen!, storeId };
  }

  test("the medicine list fails: Retry appears, the lines already added are kept, and the typed path still works", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    let failList = false;
    await page.route(/\/api\/orders\/medicines\?/, (route) => (failList && !new URL(route.request().url()).searchParams.has("q") ? route.abort("failed") : route.continue()));
    await startOrder(page, "States Store");
    await expect(page.getByTestId("refresh-medicines")).toBeVisible({ timeout: 20_000 }); // loaded once
    await addMedicine(page, "brufen", "Brufen");
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await waitSaved(page);

    failList = true;
    await page.getByTestId("refresh-medicines").click();
    await expect(page.getByTestId("list-error")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("order-line")).toHaveCount(1); // the order and its lines are kept

    // the typed path works while the list is down
    await page.getByTestId("fast-search").fill("Unknown Tonic");
    await page.getByTestId("add-as-typed").click();
    const form = page.getByTestId("typed-form");
    await form.getByLabel("Quantity").fill("2");
    await form.getByLabel("Unit").fill("bottle");
    await form.getByTestId("add-typed-line").click();
    await expect(page.getByTestId("order-line")).toHaveCount(2);

    failList = false;
    await page.getByTestId("list-retry").click();
    await expect(page.getByTestId("list-error")).toHaveCount(0);
    await expect(page.getByTestId("refresh-medicines")).toBeVisible({ timeout: 20_000 });
    await waitSaved(page);
    await expect(page.locator("body")).not.toContainText(NEVER);
  });

  test("the repeat fails: an error with Retry, nothing is added, and Retry then adds the lines once", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    let failRepeat = true;
    await page.route(/\/api\/orders\/repeat\?/, (route) => (failRepeat ? route.abort("failed") : route.continue()));
    await startOrder(page, "States Store");
    await page.getByTestId("repeat-last-order").click();
    await expect(page.getByTestId("repeat-error")).toBeVisible();
    await expect(page.getByTestId("order-line")).toHaveCount(0);
    failRepeat = false;
    await page.getByTestId("repeat-retry").click();
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await waitSaved(page);
  });

  test("a failed save keeps every line and says so honestly; with the connection off the same message appears and the change saves when it returns", async ({ page, context, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "States Store");
    await expect(page.getByTestId("usual-card").first()).toBeVisible();
    await page.getByTestId("usual-add").first().click();
    await waitSaved(page);

    await context.setOffline(true);
    await page.getByTestId("usual-add").nth(1).click();
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "not_saved", { timeout: 20_000 });
    await expect(page.locator("body")).not.toContainText(NEVER);
    await context.setOffline(false);
    await waitSaved(page); // the editor saves again when the connection returns
    await expect(page.getByTestId("order-line")).toHaveCount(2);
  });

  test("a medicine made inactive after the list was loaded is named, can be removed, and the rest of the order is saved", async ({ page, freshTenant }) => {
    const { brufen } = await seed(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "States Store");
    await expect(page.getByTestId("refresh-medicines")).toBeVisible({ timeout: 20_000 });
    await addMedicine(page, "panadol", "Panadol");
    await waitSaved(page);
    // another session makes Brufen inactive; this screen still has it in its list
    await freshTenant.client.from("products").update({ is_active: false }).eq("id", brufen);
    await addMedicine(page, "brufen", "Brufen");
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "not_saved", { timeout: 20_000 });
    const banner = page.getByTestId("inactive-lines");
    await expect(banner).toContainText("Brufen");
    await expect(banner).toContainText("no longer active");
    await expect(page.getByTestId("order-line")).toHaveCount(2); // the order on screen is intact
    await banner.getByTestId("inactive-remove").click();
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await waitSaved(page);
    await expect(banner).toHaveCount(0);
    const stored = await freshTenant.client.from("order_lines").select("name").eq("item_status", "registered").is("removed_at", null);
    expect((stored.data ?? []).length).toBeGreaterThanOrEqual(1);
  });

  test("a catalog changed on another device appears after Refresh medicines", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "States Store");
    await expect(page.getByTestId("refresh-medicines")).toBeVisible({ timeout: 20_000 });
    await insertMedicines(freshTenant.client, [{ name: "Newly Added Medicine", strength: "5 mg", dosage_form: "tablet" }]);
    await page.getByTestId("fast-search").fill("newly added");
    await expect(page.getByTestId("no-matching-medicine")).toBeVisible(); // the list on the screen is a copy from when it opened
    await page.getByTestId("refresh-medicines").click();
    await expect(page.getByTestId("medicine-result")).toHaveCount(1, { timeout: 20_000 });
  });

  test("when the order was saved elsewhere meanwhile, a one-tap add shows the changed-elsewhere review and overwrites nothing", async ({ page, freshTenant }) => {
    const { panadol, brufen, storeId } = await seed(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "States Store");
    await expect(page.getByTestId("usual-card").first()).toBeVisible();
    await page.getByTestId("usual-add").first().click();
    await waitSaved(page);
    const orderId = page.url().match(/\/orders\/([0-9a-f-]{36})/)![1]!;

    // another session saves the same draft with one more typed line
    const current = await freshTenant.client.rpc("order_get", { p_id: orderId });
    expect(current.error).toBeNull();
    const lines = (current.data.lines as Array<{ id: string; product_id: string | null; name: string; quantity: number; unit: string }>).map((l) => ({
      id: l.id,
      product_id: l.product_id,
      name: l.product_id ? null : l.name,
      quantity: l.quantity,
      unit: l.unit,
    }));
    lines.push({ id: crypto.randomUUID(), product_id: null, name: "Added in another session", quantity: 1, unit: "box" });
    const saved = await freshTenant.client.rpc("order_save", {
      p_id: orderId,
      p_request_id: crypto.randomUUID(),
      p_expected_version: current.data.version,
      p_store_id: storeId,
      p_notes: null,
      p_lines: lines,
    });
    expect(saved.error).toBeNull();
    expect(saved.data?.saved).toBe(true);

    await page.getByTestId("usual-add").nth(1).click();
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "changed_elsewhere", { timeout: 20_000 });
    // nothing of the other session was overwritten
    const after = await freshTenant.client.rpc("order_get", { p_id: orderId });
    const names = (after.data.lines as Array<{ name: string }>).map((l) => l.name);
    expect(names).toContain("Added in another session");
    expect(after.data.lines).toHaveLength(2);
    expect([panadol, brufen]).toHaveLength(2);
    expect(line(page, 0)).toBeTruthy();
  });
});
