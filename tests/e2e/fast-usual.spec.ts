import type { Locator, Page } from "@playwright/test";
import type { TestTenant } from "../helpers/supabase-test";
import { insertMedicines } from "../helpers/fast";
import { createOrder, line, seedStore, waitSaved } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US2 of Module 008: the store's usual medicines, one tap each (mobile, 360 px).
test.describe("US2: usual medicines in one tap", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  interface Seeded {
    storeId: string;
    ids: Record<"m1" | "m2" | "m3" | "m4" | "m5" | "m6" | "m7" | "inactive", string>;
  }

  /**
   * Orders (oldest first): O0 {m2}; O1 {m1, m3, m6}; O2 {m1, m3, m4, m7}; O3 {m1, m4, m5, inactive}.
   * Ranking: m1 (3 orders), m4 (2, latest O3), m3 (2, latest O2), m5 (1, O3), m7 (1, O2), m6 (1, O1), m2 (1, O0).
   */
  async function seed(tenant: TestTenant, storeName = "Usual Store"): Promise<Seeded> {
    const [m1, m2, m3, m4, m5, m6, m7, inactive] = await insertMedicines(tenant.client, [
      { name: "Usual One", strength: "500 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK", selling_price: "10.00" },
      { name: "Usual Two", strength: "250 mg", dosage_form: "capsule", pack_size: "20", manufacturer: "Abbott", selling_price: "11.00" },
      { name: "Usual Three", strength: "1 g", dosage_form: "syrup", pack_size: "60 ml", manufacturer: "Getz", selling_price: "12.00" },
      { name: "Usual Four", strength: "5 mg", dosage_form: "tablet", pack_size: "30", manufacturer: "Sami", selling_price: "13.00" },
      { name: "Usual Five", strength: "10 mg", dosage_form: "tablet", pack_size: "14", manufacturer: "Hilton", selling_price: "14.00" },
      { name: "Usual Six", strength: "20 mg", dosage_form: "injection", pack_size: "1", manufacturer: "Searle", selling_price: "15.00" },
      { name: "Usual Seven", strength: "40 mg", dosage_form: "tablet", pack_size: "28", manufacturer: "Martin Dow", selling_price: "16.00" },
      { name: "Usual Gone", strength: "1 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "Gone Co" },
    ]);
    const storeId = await seedStore(tenant, storeName);
    const orders: Array<Array<{ product_id: string; quantity: number; unit: string }>> = [
      [{ product_id: m2!, quantity: 7, unit: "strip" }],
      [{ product_id: m1!, quantity: 10, unit: "strip" }, { product_id: m3!, quantity: 5, unit: "bottle" }, { product_id: m6!, quantity: 4, unit: "box" }],
      [{ product_id: m1!, quantity: 10, unit: "strip" }, { product_id: m3!, quantity: 5, unit: "bottle" }, { product_id: m4!, quantity: 8, unit: "strip" }, { product_id: m7!, quantity: 1, unit: "box" }],
      [{ product_id: m1!, quantity: 12, unit: "box" }, { product_id: m4!, quantity: 8, unit: "strip" }, { product_id: m5!, quantity: 2, unit: "strip" }, { product_id: inactive!, quantity: 1, unit: "strip" }],
    ];
    for (const lines of orders) await createOrder(tenant, storeId, lines, { confirm: true });
    await tenant.client.from("products").update({ is_active: false }).eq("id", inactive!);
    return { storeId, ids: { m1: m1!, m2: m2!, m3: m3!, m4: m4!, m5: m5!, m6: m6!, m7: m7!, inactive: inactive! } };
  }

  async function open(page: Page, storeName = "Usual Store") {
    await page.goto("/orders/new");
    await page.getByTestId("store-option").filter({ hasText: storeName }).first().click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?store=/);
  }

  const cards = (page: Page): Locator => page.getByTestId("usual-card");

  test("cards show the identifying details and the last quantity; the inactive medicine is not shown; nothing is added or preselected", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await open(page);
    await expect(cards(page).first()).toBeVisible();
    await expect(cards(page)).toHaveCount(6); // the first six; the rest behind "Show all"
    await expect(page.getByTestId("usual-show-all")).toContainText("Show all 7");
    await expect(cards(page).nth(0).getByTestId("usual-name")).toHaveText("Usual One");
    await expect(cards(page).nth(0).getByTestId("usual-details")).toHaveText("500 mg · tablet · 10 · GSK");
    await expect(cards(page).nth(0).getByTestId("usual-last")).toContainText("12 box");
    await expect(cards(page).nth(1).getByTestId("usual-name")).toHaveText("Usual Four");
    await expect(cards(page).nth(2).getByTestId("usual-name")).toHaveText("Usual Three");
    await page.getByTestId("usual-show-all").click();
    await expect(cards(page)).toHaveCount(7);
    await expect(page.getByText("Usual Gone")).toHaveCount(0);
    // nothing was added or preselected
    await expect(page.getByTestId("order-line")).toHaveCount(0);
    for (let i = 0; i < 7; i += 1) await expect(cards(page).nth(i).getByTestId("usual-add")).toHaveAttribute("data-on-order", "false");
    await expect(page.getByTestId("confirm-order")).toBeDisabled();
  });

  test("five usual medicines take five taps and make five lines with the quantities and units shown", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await open(page);
    await expect(cards(page).first()).toBeVisible();
    let taps = 0;
    for (let i = 0; i < 5; i += 1) {
      taps += 1;
      await cards(page).nth(i).getByTestId("usual-add").click();
    }
    expect(taps).toBe(5);
    await expect(page.getByTestId("order-line")).toHaveCount(5);
    const expected: Array<[string, string, string]> = [
      ["Usual One", "12", "box"],
      ["Usual Four", "8", "strip"],
      ["Usual Three", "5", "bottle"],
      ["Usual Five", "2", "strip"],
      ["Usual Seven", "1", "box"],
    ];
    for (const [i, [name, qty, unit]] of expected.entries()) {
      await expect(line(page, i).getByTestId("line-name")).toContainText(name);
      await expect(line(page, i).getByLabel("Quantity")).toHaveValue(qty);
      await expect(line(page, i).getByLabel("Unit")).toHaveValue(unit);
    }
    await expect(cards(page).nth(0).getByTestId("usual-add")).toHaveAttribute("data-on-order", "true");
    await expect(page.getByTestId("undo-bar")).toContainText("Added Usual Seven");
    await waitSaved(page);
  });

  test("the stepper and the quick buttons change the quantity before the add and the line carries it", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await open(page);
    const card = cards(page).nth(1); // Usual Four, last 8 strip
    await card.getByTestId("usual-plus").click();
    await card.getByTestId("usual-plus").click();
    await expect(card.getByTestId("usual-quantity")).toHaveValue("10");
    await card.getByTestId("usual-quick").filter({ hasText: "50" }).click();
    await expect(card.getByTestId("usual-quantity")).toHaveValue("50");
    await expect(page.getByTestId("order-line")).toHaveCount(0); // they only fill the field
    await card.getByTestId("usual-minus").click();
    await expect(card.getByTestId("usual-quantity")).toHaveValue("49");
    await card.getByTestId("usual-add").click();
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await expect(line(page, 0).getByLabel("Quantity")).toHaveValue("49");
    // an invalid quantity cannot be added
    await cards(page).nth(0).getByTestId("usual-quantity").fill("0");
    await expect(cards(page).nth(0).getByTestId("usual-add")).toBeDisabled();
    await expect(cards(page).nth(0)).toContainText("whole number from 1 to 100,000");
  });

  test("a second tap or a quick double tap never makes a silent second line; the existing choice appears", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await open(page);
    await cards(page).nth(0).getByTestId("usual-add").dblclick();
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await expect(page.getByTestId("add-separate-line")).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await page.getByTestId("add-separate-line").click();
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await waitSaved(page);
  });
});

// The first-use and failure states of the usual list.
test.describe("US2: usual medicines states", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("a store with no confirmed order shows no cards and no repeat button, with a note that names the next step", async ({ page, freshTenant }) => {
    await seedStore(freshTenant, "Brand New Store");
    await signIn(page, freshTenant);
    await page.goto("/orders/new");
    await page.getByTestId("store-option").filter({ hasText: "Brand New Store" }).first().click();
    await expect(page.getByTestId("usual-empty")).toContainText("after its first confirmed orders");
    await expect(page.getByTestId("usual-card")).toHaveCount(0);
    await expect(page.getByTestId("repeat-last-order")).toHaveCount(0);
  });

  test("loading is shown, a failure shows Retry and keeps the order, and Retry loads the list", async ({ page, freshTenant }) => {
    const [m] = await insertMedicines(freshTenant.client, [{ name: "Retry Med", strength: "5 mg", selling_price: "10.00" }]);
    const storeId = await seedStore(freshTenant, "Retry Store");
    await createOrder(freshTenant, storeId, [{ product_id: m!, quantity: 3, unit: "strip" }], { confirm: true });
    await signIn(page, freshTenant);

    let mode: "slow" | "fail" | "ok" = "slow";
    await page.route(/\/api\/orders\/usual\?/, async (route) => {
      if (mode === "slow") {
        await new Promise((r) => setTimeout(r, 1500));
        return route.abort("failed");
      }
      return mode === "fail" ? route.abort("failed") : route.continue();
    });
    await page.goto("/orders/new");
    await page.getByTestId("store-option").filter({ hasText: "Retry Store" }).first().click();
    await expect(page.getByText("Loading usual medicines")).toBeVisible();
    await expect(page.getByTestId("error-state")).toContainText("could not be loaded", { timeout: 15_000 });
    await expect(page.getByTestId("no-lines")).toBeVisible(); // the order screen itself still works
    mode = "ok";
    await page.getByTestId("error-state").getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("usual-card")).toHaveCount(1);
  });
});
