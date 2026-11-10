import type { Page } from "@playwright/test";
import type { TestTenant } from "../helpers/supabase-test";
import { createOrder, line, seedMedicines, seedStore, type CreatedOrder } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US3 of Module 004: after a medicine is registered or linked, the same typed text in other orders is proposed
// one line at a time. Nothing is linked until the supplier confirms that line.
test.describe("US3: propose linking the same typed medicine in other orders", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  const TYPED = "Noran 20mg cap";

  async function setup(tenant: TestTenant) {
    const catalog = await seedMedicines(tenant);
    const stores: Record<string, string> = {};
    for (const name of ["Alpha Store", "Bravo Store", "Charlie Store", "Delta Store", "Echo Store"]) stores[name] = await seedStore(tenant, name);
    const typed = (quantity: number, unit = "strip", text = TYPED) => [{ product_id: null, name: text, quantity, unit }, { product_id: catalog.sellingOnlyId, quantity: 1, unit: "box" }];
    const orders: Record<string, CreatedOrder> = {
      alpha: await createOrder(tenant, stores["Alpha Store"], typed(3), { confirm: true }), // registered from here
      bravo: await createOrder(tenant, stores["Bravo Store"], typed(5, "box")), // a draft
      charlie: await createOrder(tenant, stores["Charlie Store"], typed(7), { confirm: true }),
      delta: await createOrder(tenant, stores["Delta Store"], typed(9), { confirm: true }),
      echo: await createOrder(tenant, stores["Echo Store"], typed(2, "strip", "Noran 40mg cap"), { confirm: true }),
    };
    return { catalog, orders };
  }

  type StoredOrder = { version: number; lines: Array<{ product_id: string | null; item_status: string; quantity: number; typed_name: string | null }> };
  const stored = async (tenant: TestTenant, orderId: string) => (await tenant.client.rpc("order_get", { p_id: orderId })).data as StoredOrder;

  async function registerFromAlpha(page: Page, orderId: string) {
    await page.goto(`/orders/${orderId}`);
    await line(page, 0).getByTestId("register-medicine").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("register-submit").click(); // only the prefilled name and unit
    return page.getByTestId("proposed-group");
  }

  test("after registering, each matching line is proposed with its store, order number, typed text and quantity, and one Confirm per line links only that line", async ({ page, freshTenant }) => {
    const { orders } = await setup(freshTenant);
    await signIn(page, freshTenant);
    const group = await registerFromAlpha(page, orders.alpha.id);
    await expect(group).toBeVisible();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("proposals-for")).toContainText(TYPED);
    await expect(dialog.getByTestId("proposal-line")).toHaveCount(3);
    await expect(dialog.getByTestId("proposal-confirm")).toHaveCount(3);
    await expect(dialog.getByRole("button", { name: /link all/i })).toHaveCount(0);

    for (const [key, store, quantity] of [["bravo", "Bravo Store", "5 box"], ["charlie", "Charlie Store", "7 strip"], ["delta", "Delta Store", "9 strip"]] as const) {
      const row = dialog.getByTestId("proposal-line").filter({ hasText: store });
      await expect(row).toContainText(`ORD-${String(orders[key].number).padStart(4, "0")}`);
      await expect(row.getByTestId("proposal-typed")).toHaveText(TYPED);
      await expect(row.getByTestId("proposal-qty")).toHaveText(quantity);
    }
    await expect(dialog.getByTestId("proposal-line").filter({ hasText: "Bravo Store" })).toContainText("Draft");
    await expect(dialog.getByTestId("proposal-line").filter({ hasText: "Charlie Store" })).toContainText("Confirmed");

    // the 40 mg line is only listed under "Looks different", with no Confirm of its own
    const different = dialog.getByTestId("not-proposed-group");
    await expect(different).toContainText("Looks different, not proposed (1)");
    await different.locator("summary").click();
    await expect(different.getByTestId("not-proposed-line")).toContainText("Noran 40mg cap");
    await expect(different.getByTestId("proposal-confirm")).toHaveCount(0);
    await expect(different.getByTestId("proposal-manual")).toBeVisible();

    // confirm two of the three
    await dialog.getByTestId("proposal-line").filter({ hasText: "Charlie Store" }).getByTestId("proposal-confirm").click();
    await expect(dialog.getByTestId("proposal-line").filter({ hasText: "Charlie Store" }).getByTestId("proposal-linked")).toBeVisible();
    await dialog.getByTestId("proposal-line").filter({ hasText: "Delta Store" }).getByTestId("proposal-confirm").click();
    await expect(dialog.getByTestId("proposal-line").filter({ hasText: "Delta Store" }).getByTestId("proposal-linked")).toBeVisible();
    await dialog.getByTestId("proposals-close").click();
    await expect(dialog).toBeHidden();

    const made = await freshTenant.client.from("products").select("id").eq("name", TYPED);
    expect(made.data).toHaveLength(1);
    const productId = made.data![0].id;
    for (const key of ["charlie", "delta"] as const) {
      const o = await stored(freshTenant, orders[key].id);
      expect(o.lines[0]).toMatchObject({ product_id: productId, item_status: "registered", typed_name: TYPED });
      expect(o.lines[1]).toMatchObject({ typed_name: null }); // the rest of the order is untouched
      expect(o.version).toBe(orders[key].version + 1);
    }
    const bravo = await stored(freshTenant, orders.bravo.id);
    expect(bravo.lines[0]).toMatchObject({ product_id: null, item_status: "pending_registration" });
    expect(bravo.version).toBe(orders.bravo.version);
    expect((await stored(freshTenant, orders.echo.id)).lines[0].product_id).toBeNull();
  });

  test("closing the list links nothing; it can be opened again from the medicine's own page", async ({ page, freshTenant }) => {
    const { orders } = await setup(freshTenant);
    await signIn(page, freshTenant);
    await registerFromAlpha(page, orders.alpha.id);
    await page.getByTestId("proposals-close").click();
    await expect(page.getByRole("dialog")).toBeHidden();
    for (const key of ["bravo", "charlie", "delta", "echo"] as const) {
      const o = await stored(freshTenant, orders[key].id);
      expect(o.lines[0].product_id, key).toBeNull();
      expect(o.version, key).toBe(orders[key].version);
    }

    const made = await freshTenant.client.from("products").select("id").eq("name", TYPED);
    await page.goto(`/products/${made.data![0].id}`);
    await page.getByTestId("waiting-lines").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Lines waiting for this medicine");
    await expect(dialog.getByTestId("proposal-line")).toHaveCount(3);
    await dialog.getByTestId("proposal-line").filter({ hasText: "Delta Store" }).getByTestId("proposal-confirm").click();
    await expect(dialog.getByTestId("proposal-line").filter({ hasText: "Delta Store" }).getByTestId("proposal-linked")).toBeVisible();
    expect((await stored(freshTenant, orders.delta.id)).lines[0].product_id).toBe(made.data![0].id);
  });

  test("a look-alike can be linked by hand: the comparison shows the difference, Cancel changes nothing, Confirm links that one line", async ({ page, freshTenant }) => {
    const { orders } = await setup(freshTenant);
    await signIn(page, freshTenant);
    await registerFromAlpha(page, orders.alpha.id);
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("not-proposed-group").locator("summary").click();
    await dialog.getByTestId("proposal-manual").click();

    await expect(dialog.getByTestId("link-typed")).toContainText("Noran 40mg cap");
    await expect(dialog.getByTestId("link-picked")).toContainText(TYPED);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog.getByTestId("proposal-line")).toHaveCount(3); // back on the list
    expect((await stored(freshTenant, orders.echo.id)).lines[0].product_id).toBeNull();

    await dialog.getByTestId("not-proposed-group").locator("summary").click();
    await dialog.getByTestId("proposal-manual").click();
    await dialog.getByTestId("link-confirm-button").click(); // the medicine has no selling price: no price question
    await expect(dialog.getByTestId("proposal-line")).toHaveCount(3);
    const echo = await stored(freshTenant, orders.echo.id);
    expect(echo.lines[0]).toMatchObject({ item_status: "registered", typed_name: "Noran 40mg cap" });
    expect(echo.lines[0].product_id).not.toBeNull();
    await expect(dialog.getByTestId("not-proposed-group")).toHaveCount(0); // it is linked now
  });

  test("a draft open in another page is told it changed elsewhere after its line was linked, and keeps its typed data", async ({ page, context, freshTenant }) => {
    const { orders } = await setup(freshTenant);
    await signIn(page, freshTenant);
    const other = await context.newPage();
    await other.goto(`/orders/${orders.bravo.id}`);
    await expect(line(other, 0).getByLabel("Quantity")).toHaveValue("5");

    await registerFromAlpha(page, orders.alpha.id);
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("proposal-line").filter({ hasText: "Bravo Store" }).getByTestId("proposal-confirm").click();
    await expect(dialog.getByTestId("proposal-line").filter({ hasText: "Bravo Store" }).getByTestId("proposal-linked")).toBeVisible();

    await line(other, 0).getByLabel("Quantity").fill("8");
    await expect(other.getByTestId("save-status")).toHaveAttribute("data-state", "changed_elsewhere", { timeout: 15_000 });
    await expect(line(other, 0).getByLabel("Quantity")).toHaveValue("8");
    expect((await stored(freshTenant, orders.bravo.id)).lines[0].quantity).toBe(5); // nothing was overwritten
  });

  test("another line of the order that is open is linked and the screen shows it at once", async ({ page, freshTenant }) => {
    const catalog = await seedMedicines(freshTenant);
    const store = await seedStore(freshTenant, "Same Order Store");
    const order = await createOrder(
      freshTenant,
      store,
      [{ product_id: null, name: TYPED, quantity: 3, unit: "strip" }, { product_id: null, name: "noran 20mg CAP", quantity: 4, unit: "box" }, { product_id: catalog.sellingOnlyId, quantity: 1, unit: "box" }],
      { confirm: true },
    );
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    await line(page, 0).getByTestId("register-medicine").click();
    await page.getByRole("dialog").getByTestId("register-submit").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("proposal-line")).toHaveCount(1);
    await expect(dialog.getByTestId("proposal-typed")).toHaveText("noran 20mg CAP"); // shown exactly as typed
    await dialog.getByTestId("proposal-confirm").click();
    await expect(dialog.getByTestId("proposal-linked")).toBeVisible();
    await dialog.getByTestId("proposals-close").click();
    await expect(line(page, 1).getByTestId("line-typed-name")).toHaveText("As typed: noran 20mg CAP");
    await expect(line(page, 1).getByTestId("line-qty-unit")).toContainText("4");
    await expect(page.getByTestId("register-medicine")).toHaveCount(0); // no typed line is left on the screen
  });

  test("linking a line to an existing medicine proposes the other lines typed the same way", async ({ page, freshTenant }) => {
    const catalog = await seedMedicines(freshTenant);
    const a = await seedStore(freshTenant, "Link Store A");
    const b = await seedStore(freshTenant, "Link Store B");
    const first = await createOrder(freshTenant, a, [{ product_id: null, name: "panadol 500mg", quantity: 3, unit: "strip" }], { confirm: true });
    await createOrder(freshTenant, b, [{ product_id: null, name: "Panadol 500mg", quantity: 6, unit: "strip" }], { confirm: true });
    await signIn(page, freshTenant);
    await page.goto(`/orders/${first.id}`);
    await line(page, 0).getByTestId("link-existing-medicine").click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Search medicines").fill("panadol");
    await dialog.getByTestId("link-result").filter({ hasText: "Panadol 500mg" }).first().click();
    await dialog.getByTestId("link-confirm-button").click();
    await dialog.getByTestId("link-price-no").click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("proposal-line")).toHaveCount(1);
    await expect(dialog.getByTestId("proposal-line")).toContainText("Link Store B");
    expect(catalog.pricedId).toBeTruthy();
  });

  test("when nothing else matches no list opens, and the medicine's page says so", async ({ page, freshTenant }) => {
    const catalog = await seedMedicines(freshTenant);
    const store = await seedStore(freshTenant, "Lonely Store");
    const order = await createOrder(freshTenant, store, [{ product_id: null, name: "Lonely Typed", quantity: 1, unit: "strip" }, { product_id: catalog.sellingOnlyId, quantity: 1, unit: "box" }], { confirm: true });
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    await line(page, 0).getByTestId("register-medicine").click();
    await page.getByRole("dialog").getByTestId("register-submit").click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(line(page, 0).getByTestId("line-typed-name")).toBeVisible();

    await page.goto(`/products/${catalog.pricedId}`);
    await page.getByTestId("waiting-lines").click();
    await expect(page.getByTestId("proposals-empty")).toContainText("No other typed lines are waiting for this medicine.");
    await page.getByTestId("proposals-close").click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("with the connection failing a confirm shows an error with a way to retry; retrying links once", async ({ page, freshTenant }) => {
    const { orders } = await setup(freshTenant);
    await signIn(page, freshTenant);
    await registerFromAlpha(page, orders.alpha.id);
    const dialog = page.getByRole("dialog");
    let blocked = true;
    await page.route("**/api/orders/*/lines/*/link", (route) => (blocked ? route.abort() : route.continue()));
    const row = dialog.getByTestId("proposal-line").filter({ hasText: "Charlie Store" });
    await row.getByTestId("proposal-confirm").click();
    await expect(row.getByRole("alert")).toContainText("Can't reach the server");
    expect((await stored(freshTenant, orders.charlie.id)).lines[0].product_id).toBeNull();
    blocked = false;
    await row.getByTestId("proposal-confirm").click();
    await expect(row.getByTestId("proposal-linked")).toBeVisible();
    const events = await freshTenant.client.from("order_events").select("id").eq("order_id", orders.charlie.id).eq("event_type", "linked");
    expect(events.data).toHaveLength(1);
  });
});
