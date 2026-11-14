import { randomUUID } from "node:crypto";
import { expect, signIn, smallTargets, test } from "./fixtures";

// SC-007: at 360 px every interactive control is at least 44 x 44 px, and nothing overflows sideways.
// Every screen is measured only after its data and content have loaded; measuring earlier can miss
// controls that appear later (the setup checklist and the settings form load their data first).
test.describe("touch targets and layout at 360 px", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("sign-in screen", async ({ page, tenant }) => {
    void tenant;
    await page.goto("/sign-in");
    await page.waitForLoadState("networkidle");
    expect(await smallTargets(page)).toEqual([]);
  });

  test("every signed-in screen", async ({ page, tenant }) => {
    await signIn(page, tenant);
    for (const path of ["/", "/products", "/products/new", "/products/import", "/stores", "/stores/new", "/settings"]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      if (path === "/settings") {
        await expect(page.getByLabel("Business name")).toBeVisible();
        await expect(page.locator("#summary")).toBeVisible();
      }
      expect(await smallTargets(page), `small targets on ${path}`).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
    }
  });

  test("home with completed setup items shows 'Open' links that are large enough", async ({ page, freshTenant }) => {
    // A store and a medicine make two checklist items "done", which shows their "Open" links.
    const store = await freshTenant.client.from("stores").insert({ id: randomUUID(), name: "Touch Target Store" });
    expect(store.error).toBeNull();
    const product = await freshTenant.client.from("products").insert({ id: randomUUID(), name: "Touch Target Medicine", unit: "strip" });
    expect(product.error).toBeNull();

    await signIn(page, freshTenant);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("link", { name: "Open", exact: true }).first()).toBeVisible();
    expect(await smallTargets(page), "small targets on / with done checklist items").toEqual([]);
  });
});

test.describe("order screens at 360 px", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("every order screen has no small targets and no sideways scroll", async ({ page, freshTenant }) => {
    const { seedMedicines, seedStore, createOrder } = await import("./orders-helpers");
    const catalog = await seedMedicines(freshTenant);
    const store = await seedStore(freshTenant);
    const lines = [
      { product_id: catalog.pricedId, quantity: 2, unit: "strip" },
      { product_id: null, name: "Typed Item", quantity: 1, unit: "box" },
    ];
    const draft = await createOrder(freshTenant, store, lines);
    const confirmed = await createOrder(freshTenant, store, lines, { confirm: true });
    const cancelled = await createOrder(freshTenant, store, lines, { confirm: true });
    const cancel = await freshTenant.client.rpc("order_cancel", { p_id: cancelled.id, p_request_id: crypto.randomUUID(), p_expected_version: cancelled.version, p_reason: "test" });
    expect(cancel.error).toBeNull();

    await signIn(page, freshTenant);
    for (const path of ["/orders", "/orders/new", `/orders/${draft.id}`, `/orders/${confirmed.id}`, `/orders/${cancelled.id}`]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("loading")).toHaveCount(0);
      expect(await smallTargets(page), `small targets on ${path}`).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
    }

    // the open dialogs: medicine search, typed form, and the edit screen of a confirmed order
    await page.goto(`/orders/${draft.id}`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("add-medicine").click();
    await expect(page.getByRole("dialog").getByTestId("medicine-result").first()).toBeVisible();
    expect(await smallTargets(page), "small targets in the medicine search").toEqual([]);
    await page.getByRole("dialog").getByLabel("Search medicines").fill("nothing matches this");
    await page.getByTestId("add-as-typed").click();
    await expect(page.getByRole("dialog").getByLabel("Medicine name")).toBeVisible();
    expect(await smallTargets(page), "small targets in the typed form").toEqual([]);
    await page.keyboard.press("Escape");

    await page.goto(`/orders/${confirmed.id}`);
    await page.getByTestId("edit-order").click();
    await page.waitForLoadState("networkidle");
    expect(await smallTargets(page), "small targets while editing a confirmed order").toEqual([]);
  });
});

// Module 004 (SC-012): the Pending screens and their dialogs at 360 px.
test.describe("pending screens at 360 px", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("every pending screen and dialog has no small targets and no sideways scroll", async ({ page, freshTenant }) => {
    const { seedMedicines, seedStore, createOrder } = await import("./orders-helpers");
    const catalog = await seedMedicines(freshTenant);
    const alpha = await seedStore(freshTenant, "Alpha Store");
    const bravo = await seedStore(freshTenant, "Bravo Store");
    // two typed lines with the same text (so the proposals dialog has something to show) and an unpriced medicine
    const first = await createOrder(freshTenant, alpha, [{ product_id: null, name: "Noran 20mg", quantity: 3, unit: "strip" }, { product_id: catalog.noPriceId, quantity: 2, unit: "bottle" }], { confirm: true });
    await createOrder(freshTenant, bravo, [{ product_id: null, name: "Noran 20mg", quantity: 4, unit: "box" }]);

    const check = async (what: string) => {
      expect(await smallTargets(page), `small targets: ${what}`).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `horizontal overflow: ${what}`).toBeLessThanOrEqual(1);
    };

    await signIn(page, freshTenant);
    for (const path of ["/", "/pending?tab=register", "/pending?tab=prices", `/pending/prices/${catalog.noPriceId}`]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("loading")).toHaveCount(0);
      await expect(page.getByTestId("pending-summary-loading")).toHaveCount(0);
      await check(path);
    }

    // the price screen after the review (the list of lines) and after the fill (the result)
    await page.goto(`/pending/prices/${catalog.noPriceId}`);
    await page.getByTestId("price-input").fill("125.50");
    await page.getByTestId("price-review").click();
    await expect(page.getByTestId("review-panel")).toBeVisible();
    await check("price review");
    await page.getByTestId("fill-confirm").click();
    await expect(page.getByTestId("fill-result")).toBeVisible();
    await check("price result");

    // the dialogs, opened from the To register tab
    await page.goto("/pending?tab=register");
    await expect(page.getByTestId("typed-group")).toHaveCount(1);
    await page.getByTestId("typed-line").first().getByTestId("link-existing-medicine").click();
    const linkDialog = page.getByRole("dialog");
    await expect(linkDialog.getByTestId("link-result").first()).toBeVisible();
    await check("link dialog (search)");
    await linkDialog.getByLabel("Search medicines").fill("panadol");
    await linkDialog.getByTestId("link-result").filter({ hasText: "Panadol 500mg" }).first().click();
    await expect(linkDialog.getByTestId("link-picked")).toBeVisible();
    await check("link dialog (compare)");
    await page.keyboard.press("Escape");

    await page.getByTestId("typed-line").first().getByTestId("register-medicine").click();
    const registerDialog = page.getByRole("dialog");
    await expect(registerDialog.getByLabel(/^Medicine name/)).toBeVisible();
    await check("register dialog");
    await registerDialog.getByTestId("register-more").click();
    await check("register dialog (more details)");
    await registerDialog.getByTestId("register-submit").click();
    await expect(page.getByTestId("proposed-group")).toBeVisible(); // the other order's line is proposed
    await check("proposals dialog");
    await page.getByTestId("proposals-close").click();

    // the order screen keeps the Pending link and the medicine page keeps its entry
    await page.goto(`/orders/${first.id}`);
    await page.waitForLoadState("networkidle");
    await check("confirmed order with a registered line");
  });
});

// Module 005: the market list screens and their dialogs at 360 px.
test.describe("Module 005: market list touch targets and layout at 360 px", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("the list, the purchase dialogs, the price offer, the print page and the Home card", async ({ page, freshTenant }) => {
    const { seedMarketDay } = await import("./market-helpers");
    await seedMarketDay(freshTenant);
    await signIn(page, freshTenant);

    const check = async (label: string) => {
      expect(await smallTargets(page), `small targets: ${label}`).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `horizontal overflow: ${label}`).toBeLessThanOrEqual(1);
    };

    await page.goto("/");
    await expect(page.getByTestId("market-summary-count")).toBeVisible();
    await check("home with the market card");

    await page.goto("/market-list");
    await expect(page.getByTestId("market-row")).toHaveCount(3);
    await page.waitForLoadState("networkidle");
    await check("market list with rows");
    await page.getByTestId("store-filter").locator("summary").click();
    await check("market list with the store filter open");
    await page.getByTestId("store-filter").locator("summary").click();

    const panadol = page.getByTestId("market-row").filter({ hasText: "500 mg" });
    await panadol.getByTestId("record-purchase").click();
    await expect(page.getByRole("dialog").getByLabel(/Quantity bought/)).toBeVisible();
    await check("record purchase dialog");
    await page.getByRole("dialog").getByLabel("Purchase date").fill("2026-01-05");
    await expect(page.getByText(/This purchase will count for/)).toBeVisible();
    await check("record purchase dialog with the date notice");
    await page.getByRole("dialog").getByLabel("Purchase date").fill(new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10));
    await page.getByRole("dialog").getByLabel(/Quantity bought/).fill("5");
    await page.getByRole("dialog").getByLabel(/Cost per unit/).fill("88.5");
    await page.getByRole("dialog").getByTestId("save-purchase").click();
    await expect(page.getByTestId("update-cost-offer")).toBeVisible();
    await check("purchase price offer");
    await page.getByTestId("keep-cost").click();

    await panadol.getByTestId("purchase-history-open").click();
    await expect(page.getByTestId("purchase-entry")).toHaveCount(1);
    await check("purchase history dialog");
    await page.getByTestId("cancel-entry").click();
    await expect(page.getByTestId("cancel-entry-form")).toBeVisible();
    await check("cancel entry form");
    await page.keyboard.press("Escape");

    await page.goto("/market-list/print");
    await expect(page.getByTestId("print-rows")).toBeVisible();
    await check("print page");
  });

  test("the empty list", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/market-list");
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await smallTargets(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  });
});
