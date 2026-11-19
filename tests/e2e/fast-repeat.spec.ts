import type { Locator, Page } from "@playwright/test";
import type { TestTenant } from "../helpers/supabase-test";
import { createOrder, line, seedMedicines, seedStore, type SeededCatalog, waitSaved } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US1 of Module 008: repeat the store's last order (mobile, 360 px).
test.describe("US1: repeat the last order", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  const FORBIDDEN = /purchase|\bmrp\b|\bcost\b|margin|profit|snapshot/i;

  async function seedHistory(tenant: TestTenant, storeName = "Repeat Store"): Promise<{ catalog: SeededCatalog; storeId: string; sourceId: string }> {
    const catalog = await seedMedicines(tenant);
    const storeId = await seedStore(tenant, storeName);
    const source = await createOrder(
      tenant,
      storeId,
      [
        { product_id: catalog.pricedId, quantity: 12, unit: "strip" },
        { product_id: catalog.sellingOnlyId, quantity: 3, unit: "box" },
        { product_id: null, name: "Typed Cough Syrup", quantity: 2, unit: "bottle" },
        { product_id: catalog.noPriceId, quantity: 4, unit: "bottle" },
        { product_id: catalog.pricedId, quantity: 1, unit: "box" },
      ],
      { confirm: true },
    );
    return { catalog, storeId, sourceId: source.id };
  }

  /** Counts every tap the supplier makes. */
  function tapCounter() {
    let taps = 0;
    return {
      tap: async (locator: Locator) => {
        taps += 1;
        await locator.click();
      },
      get count() {
        return taps;
      },
    };
  }

  async function openNewOrder(page: Page, tap: (l: Locator) => Promise<void>, storeName: string) {
    await page.goto("/orders/new");
    await tap(page.getByTestId("store-option").filter({ hasText: storeName }).first());
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?store=/);
  }

  test("one tap copies every line into a new draft, no price is requested, and the order confirms in four taps", async ({ page, freshTenant }) => {
    const { storeId, sourceId } = await seedHistory(freshTenant);
    await signIn(page, freshTenant);
    const bodies: string[] = [];
    page.on("response", async (response) => {
      if (/\/api\/orders\/(usual|repeat)\?/.test(response.url())) bodies.push(await response.text());
    });

    const counter = tapCounter();
    await openNewOrder(page, counter.tap, "Repeat Store");

    // The button names its source and nothing is added before the tap.
    const button = page.getByTestId("repeat-last-order");
    await expect(button).toBeVisible();
    await expect(page.getByTestId("repeat-source")).toContainText("5 lines");
    await expect(page.getByTestId("no-lines")).toBeVisible();
    await expect(page.getByTestId("order-line")).toHaveCount(0);
    await expect(page.getByTestId("confirm-order")).toBeDisabled();

    await counter.tap(button);
    await expect(page.getByTestId("order-line")).toHaveCount(5);
    const expected: Array<[string, string, string]> = [
      ["Panadol 500mg", "12", "strip"],
      ["Brufen 400mg", "3", "box"],
      ["Typed Cough Syrup", "2", "bottle"],
      ["Calpol Syrup", "4", "bottle"],
      ["Panadol 500mg", "1", "box"],
    ];
    for (const [i, [name, qty, unit]] of expected.entries()) {
      // a typed line shows its exact text in an editable name field, a catalog line shows the medicine name
      if (i === 2) await expect(line(page, i).getByLabel("Medicine name")).toHaveValue(name);
      else await expect(line(page, i).getByTestId("line-name")).toContainText(name);
      await expect(line(page, i).getByLabel("Quantity")).toHaveValue(qty);
      await expect(line(page, i).getByLabel("Unit")).toHaveValue(unit);
    }
    await expect(line(page, 2)).toContainText("Not registered");
    await expect(line(page, 0)).not.toContainText("Not registered");
    await expect(page.getByTestId("repeat-last-order")).toHaveCount(0); // hidden once the draft has lines
    await waitSaved(page);

    await counter.tap(page.getByTestId("confirm-order"));
    await counter.tap(page.getByTestId("confirm-order-yes"));
    await expect(page.getByTestId("order-status")).toContainText("Confirmed", { timeout: 15_000 });
    // store, repeat, confirm button, then the existing confirmation question: four taps, three interactions (SC-001).
    expect(counter.count).toBe(4);

    // No price, MRP, cost or snapshot was requested or returned by the two new routes.
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    for (const body of bodies) expect(body).not.toMatch(FORBIDDEN);

    // The old order is unchanged and exactly one new order exists with the same five lines.
    const orders = await freshTenant.client.from("orders").select("id,status").eq("store_id", storeId);
    expect(orders.data).toHaveLength(2);
    const fresh = (orders.data ?? []).find((o) => o.id !== sourceId)!;
    const [oldLines, newLines] = await Promise.all([
      freshTenant.client.from("order_lines").select("id").eq("order_id", sourceId).is("removed_at", null),
      freshTenant.client.from("order_lines").select("id").eq("order_id", fresh.id).is("removed_at", null),
    ]);
    expect(oldLines.data).toHaveLength(5);
    expect(newLines.data).toHaveLength(5);
  });

  test("Undo removes exactly the lines the repeat added", async ({ page, freshTenant }) => {
    await seedHistory(freshTenant);
    await signIn(page, freshTenant);
    await openNewOrder(page, (l) => l.click(), "Repeat Store");
    await page.getByTestId("repeat-last-order").click();
    await expect(page.getByTestId("order-line")).toHaveCount(5);
    await expect(page.getByTestId("undo-bar")).toContainText("Added 5 lines");
    await page.getByTestId("undo-action").click();
    await expect(page.getByTestId("order-line")).toHaveCount(0);
    await expect(page.getByTestId("undo-bar")).toHaveCount(0);
    await expect(page.getByTestId("repeat-last-order")).toBeVisible();
    await expect(page.getByTestId("save-status")).not.toHaveAttribute("data-state", "not_saved");
  });
});
