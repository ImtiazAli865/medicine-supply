import { insertMedicines, seedSimilar } from "../helpers/fast";
import { createOrder, seedStore, startOrder } from "./orders-helpers";
import { expect, signIn, smallTargets, test } from "./fixtures";
import { blockDeviceStorage } from "../helpers/offline";

// SC-009 of Module 008: every new control and message on the order screen is at least 44 x 44 px at 360 px, nothing
// scrolls sideways, and the bottom navigation keeps its five items.
test.describe("Module 008: touch targets and layout at 360 px", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  async function expectLayout(page: import("@playwright/test").Page, label: string) {
    expect(await smallTargets(page), `small targets: ${label}`).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow: ${label}`).toBeLessThanOrEqual(1);
  }

  test("the order screen with usual cards, the repeat button, results, the quantity block, the typed form, the undo bar and the messages", async ({ page, freshTenant }) => {
    const similar = await seedSimilar(freshTenant.client);
    const [brufen] = await insertMedicines(freshTenant.client, [{ name: "Brufen", strength: "400 mg", dosage_form: "tablet", pack_size: "20", manufacturer: "Abbott", selling_price: "20.00" }]);
    const storeId = await seedStore(freshTenant, "Layout Store");
    await createOrder(
      freshTenant,
      storeId,
      [
        { product_id: similar.p250, quantity: 5, unit: "strip" },
        { product_id: similar.p500, quantity: 3, unit: "box" },
        { product_id: brufen!, quantity: 2, unit: "box" },
        { product_id: null, name: "A typed medicine with a rather long name to check wrapping", quantity: 1, unit: "bottle" },
      ],
      { confirm: true },
    );
    await freshTenant.client.from("products").update({ is_active: false }).eq("id", similar.p500x);
    await signIn(page, freshTenant);
    await startOrder(page, "Layout Store");

    // the new order screen: search box, repeat button, usual cards
    await expect(page.getByTestId("usual-card").first()).toBeVisible();
    await expect(page.getByTestId("repeat-last-order")).toBeVisible();
    await expectLayout(page, "new order screen with usual cards and the repeat button");

    // a search with results, the chosen medicine with the quantity block, the quantity error
    await page.getByTestId("fast-search").fill("panadol");
    await expect(page.getByTestId("medicine-result").first()).toBeVisible();
    await expectLayout(page, "search results");
    await page.getByTestId("fast-search").fill("bruf");
    await expect(page.getByTestId("medicine-result")).toHaveCount(1);
    await page.getByTestId("fast-search").press("Enter");
    await expect(page.getByTestId("fast-chosen")).toBeVisible();
    await expectLayout(page, "chosen medicine with the quantity block");
    await page.getByTestId("fast-quantity").fill("0");
    await page.getByTestId("fast-quantity").press("Enter");
    await expect(page.getByTestId("fast-quantity-error")).toBeVisible();
    await expectLayout(page, "quantity error");
    await page.getByTestId("fast-cancel").click();

    // the quantity hint tag, and its error
    await page.getByTestId("fast-search").fill("pan x20");
    await expect(page.getByTestId("fast-quantity-tag")).toBeVisible();
    await expectLayout(page, "quantity tag");
    await page.getByTestId("fast-search").fill("pan x0");
    await expect(page.getByTestId("fast-quantity-tag")).toContainText("whole number");
    await expectLayout(page, "quantity tag error");

    // the typed form
    await page.getByTestId("fast-search").fill("nothing matches this at all");
    await page.getByTestId("add-as-typed").click();
    await expect(page.getByTestId("typed-form")).toBeVisible();
    await expectLayout(page, "typed form");
    await page.getByTestId("typed-cancel").click();
    await page.getByTestId("fast-search").fill("");

    // the undo bar after a usual-card add, and the left-out message after a repeat
    await page.getByTestId("usual-add").first().click();
    await expect(page.getByTestId("undo-bar")).toBeVisible();
    await expectLayout(page, "undo bar and a line on the order");
    await page.getByTestId("undo-action").click();
    await freshTenant.client.from("products").update({ is_active: false }).eq("id", brufen!);
    await page.reload();
    await page.getByTestId("repeat-last-order").click();
    await expect(page.getByTestId("repeat-skipped")).toBeVisible();
    await expectLayout(page, "left-out message after a repeat");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(5);
  });

  test("the failure and loading states of the new lists", async ({ page, freshTenant }) => {
    const [m] = await insertMedicines(freshTenant.client, [{ name: "State Med", strength: "5 mg", selling_price: "10.00" }]);
    const storeId = await seedStore(freshTenant, "State Layout Store");
    await createOrder(freshTenant, storeId, [{ product_id: m!, quantity: 3, unit: "strip" }], { confirm: true });
    await blockDeviceStorage(page); // this test checks the online failure state, with no copy kept on the device
    await signIn(page, freshTenant);
    await page.route(/\/api\/orders\/(usual|repeat|medicines)\?/, (route) => route.abort("failed"));
    await startOrder(page, "State Layout Store");
    await expect(page.getByTestId("error-state")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("list-error")).toBeVisible({ timeout: 20_000 });
    await expectLayout(page, "usual list error and medicine list error");
    await page.getByTestId("fast-search").fill("state");
    await expect(page.getByTestId("search-error").or(page.getByTestId("error-state")).first()).toBeVisible({ timeout: 20_000 });
    await expectLayout(page, "search error");
  });
});
