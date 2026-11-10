import { createOrder, line, seedMedicines, seedStore } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US2 of Module 004: link a typed line to a medicine that already exists. Nothing is linked before Confirm.
test.describe("US2: link a typed line to an existing medicine", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  async function setup(freshTenant: Parameters<typeof seedStore>[0], typed = "panadol 500", confirm = true) {
    const catalog = await seedMedicines(freshTenant);
    const store = await seedStore(freshTenant);
    const order = await createOrder(
      freshTenant,
      store,
      [
        { product_id: null, name: typed, quantity: 3, unit: "strip" },
        { product_id: catalog.sellingOnlyId, quantity: 2, unit: "box" },
      ],
      { confirm },
    );
    return { catalog, store, order };
  }

  async function pick(page: import("@playwright/test").Page, search: string, name: string) {
    await line(page, 0).getByTestId("link-existing-medicine").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Search medicines").fill(search);
    await dialog.getByTestId("link-result").filter({ hasText: name }).first().click();
    return dialog;
  }

  test("search, pick, compare side by side, confirm: the line is linked and keeps the typed text and quantity", async ({ page, freshTenant }) => {
    const { order } = await setup(freshTenant);
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    const dialog = await pick(page, "panadol", "Panadol 500mg");

    await expect(dialog.getByTestId("link-typed")).toContainText("panadol 500");
    await expect(dialog.getByTestId("link-typed")).toContainText("3 strip");
    await expect(dialog.getByTestId("link-picked")).toContainText("Panadol 500mg");
    await expect(dialog.getByTestId("link-picked")).toContainText("500 mg");
    await expect(dialog.getByTestId("link-picked")).toContainText("tablet");
    await expect(dialog.getByTestId("link-picked")).toContainText("GSK");
    // nothing is linked before Confirm
    const before = await freshTenant.client.rpc("order_get", { p_id: order.id });
    expect(before.data.lines[0].product_id).toBeNull();

    await dialog.getByTestId("link-confirm-button").click();
    // Panadol has a selling price and the order is confirmed: the supplier decides about the price
    await expect(dialog.getByTestId("link-price-step")).toContainText("PKR 125.50");
    await dialog.getByTestId("link-price-yes").click();
    await expect(dialog).toBeHidden();

    const linked = line(page, 0);
    await expect(linked.getByTestId("line-typed-name")).toHaveText("As typed: panadol 500");
    await expect(linked).toContainText("Panadol 500mg");
    await expect(linked.getByTestId("line-qty-unit")).toContainText("3");
    await expect(linked.getByTestId("line-price")).toContainText("PKR 125.50");
    await expect(linked.getByTestId("line-total")).toHaveText("PKR 376.50");
    await expect(page.getByTestId("order-history-log")).toContainText("linked to an existing medicine");
    await expect(page.getByTestId("order-line")).toHaveCount(2);
  });

  test("answering No to the price question links the line but leaves it without a price", async ({ page, freshTenant }) => {
    const { order } = await setup(freshTenant);
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    const dialog = await pick(page, "panadol", "Panadol 500mg");
    await dialog.getByTestId("link-confirm-button").click();
    await dialog.getByTestId("link-price-no").click();
    await expect(dialog).toBeHidden();
    await expect(line(page, 0)).toContainText("Panadol 500mg");
    await expect(line(page, 0)).toContainText("No selling price");
    await expect(line(page, 0).getByTestId("line-price")).toHaveCount(0);
    await expect(page.getByTestId("order-history-log")).toContainText("no price recorded");
  });

  test("a medicine with a different strength can be picked, the comparison shows it, and nothing is linked before Confirm; Cancel changes nothing", async ({ page, freshTenant }) => {
    const { order } = await setup(freshTenant, "panadol 250");
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    const dialog = await pick(page, "panadol", "Panadol 500mg");
    await expect(dialog.getByTestId("link-typed")).toContainText("panadol 250");
    await expect(dialog.getByTestId("link-picked")).toContainText("500 mg"); // the difference is visible
    await dialog.getByRole("button", { name: "Pick another" }).click();
    await expect(dialog.getByLabel("Search medicines")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(line(page, 0)).toContainText("Not registered");
    const stored = await freshTenant.client.rpc("order_get", { p_id: order.id });
    expect(stored.data.lines[0].product_id).toBeNull();
    expect(stored.data.version).toBe(order.version);
  });

  test("inactive medicines are not offered", async ({ page, freshTenant }) => {
    const { order, catalog } = await setup(freshTenant);
    await freshTenant.client.from("products").update({ is_active: false }).eq("id", catalog.noPriceId);
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    await line(page, 0).getByTestId("link-existing-medicine").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Search medicines").fill("calpol");
    await expect(dialog.getByTestId("no-matching-medicine")).toBeVisible();
    await expect(dialog.getByTestId("link-result")).toHaveCount(0);
  });

  test("an exact duplicate found while registering goes straight to 'Use the existing medicine'", async ({ page, freshTenant }) => {
    const { order } = await setup(freshTenant, "brufen typed");
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    await line(page, 0).getByTestId("register-medicine").click();
    const reg = page.getByRole("dialog");
    await reg.getByLabel(/^Medicine name/).fill("brufen 400mg");
    await reg.getByTestId("register-more").click();
    await reg.getByLabel("Strength", { exact: true }).fill("400 mg");
    await reg.getByLabel("Dosage form", { exact: true }).fill("tablet");
    await reg.getByTestId("register-submit").click();
    await reg.getByTestId("use-existing-medicine").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("link-picked")).toContainText("Brufen 400mg");
    await dialog.getByTestId("link-confirm-button").click();
    await dialog.getByTestId("link-price-no").click();
    await expect(dialog).toBeHidden();
    await expect(line(page, 0).getByTestId("line-typed-name")).toHaveText("As typed: brufen typed");
    const medicines = await freshTenant.client.from("products").select("id").ilike("name", "%brufen%");
    expect(medicines.data).toHaveLength(1); // no duplicate was created
  });

  test("on a draft the link works and the draft then follows the medicine's current price", async ({ page, freshTenant }) => {
    const { order } = await setup(freshTenant, "panadol 500", false);
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    const dialog = await pick(page, "panadol", "Panadol 500mg");
    await dialog.getByTestId("link-confirm-button").click(); // a draft has no price question
    await expect(dialog).toBeHidden();
    await expect(line(page, 0).getByTestId("line-typed-name")).toHaveText("As typed: panadol 500");
    await expect(line(page, 0).getByTestId("line-price")).toContainText("Current price PKR 125.50");
  });

  test("with the connection failing nothing is linked and an error with a way to retry is shown; retrying links once", async ({ page, freshTenant }) => {
    const { order } = await setup(freshTenant);
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    const dialog = await pick(page, "calpol", "Calpol Syrup"); // no selling price: no price question
    let blocked = true;
    await page.route("**/api/orders/*/lines/*/link", (route) => (blocked ? route.abort() : route.continue()));
    await dialog.getByTestId("link-confirm-button").click();
    await expect(dialog.getByRole("alert")).toContainText("Can't reach the server");
    const stored = await freshTenant.client.rpc("order_get", { p_id: order.id });
    expect(stored.data.lines[0].product_id).toBeNull();
    blocked = false;
    await dialog.getByTestId("link-confirm-button").click();
    await expect(dialog).toBeHidden();
    await expect(line(page, 0).getByTestId("line-typed-name")).toBeVisible();
    const events = await freshTenant.client.from("order_events").select("id").eq("order_id", order.id).eq("event_type", "linked");
    expect(events.data).toHaveLength(1);
  });
});
