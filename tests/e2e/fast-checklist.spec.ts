import type { Page } from "@playwright/test";
import { insertMedicines } from "../helpers/fast";
import type { TestTenant } from "../helpers/supabase-test";
import { addMedicine, createOrder, line, seedStore, waitSaved } from "./orders-helpers";
import { expect, signIn, smallTargets, test } from "./fixtures";
import { blockDeviceStorage } from "../helpers/offline";

// User story 6 of Module 008: the last order as a checklist (mobile, 360 px). The owner's orders have 20 to 30 lines.
test.describe("US6: choose from the last order on a checklist", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  const NAMES = Array.from({ length: 25 }, (_, i) => `Check ${String(i + 1).padStart(2, "0")}`);

  /** A store whose last confirmed order has 25 lines: line i has quantity i + 1 (strip). */
  async function seed(tenant: TestTenant) {
    const ids = await insertMedicines(
      tenant.client,
      NAMES.map((name, i) => ({ name, strength: `${(i % 5) * 100 + 100} mg`, dosage_form: "tablet", pack_size: "10", manufacturer: "Maker", selling_price: "10.00" })),
    );
    const storeId = await seedStore(tenant, "Checklist Store");
    await createOrder(
      tenant,
      storeId,
      ids.map((id, i) => ({ product_id: id, quantity: i + 1, unit: "strip" })),
      { confirm: true },
    );
    return { ids, storeId };
  }

  async function open(page: Page) {
    await page.goto("/orders/new");
    await page.getByTestId("store-option").filter({ hasText: "Checklist Store" }).first().click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?store=/);
  }

  const rows = (page: Page) => page.getByTestId("checklist-row");
  const toggle = (page: Page, index: number) => rows(page).nth(index).getByTestId("checklist-toggle");

  test("eight of 25 rows are chosen with nine taps, one quantity is changed, and they are added in one save with one Undo", async ({ page, freshTenant }) => {
    const { storeId } = await seed(freshTenant);
    await signIn(page, freshTenant);
    const bodies: string[] = [];
    page.on("response", async (response) => {
      if (/\/api\/orders\/repeat\?/.test(response.url())) bodies.push(await response.text());
    });
    await open(page);

    // the control names the source; nothing is added or selected before it is opened
    await expect(page.getByTestId("checklist-source")).toContainText("25 lines");
    await expect(rows(page)).toHaveCount(0);
    await page.getByTestId("checklist-open").click();
    await expect(rows(page)).toHaveCount(25);
    await expect(page.getByTestId("order-line")).toHaveCount(0);
    for (let i = 0; i < 25; i += 1) await expect(rows(page).nth(i)).toHaveAttribute("data-selected", "false");
    await expect(page.getByTestId("checklist-add")).toBeDisabled();
    await expect(rows(page).nth(0)).toContainText("Check 01");
    await expect(rows(page).nth(0)).toContainText("1 strip");

    // eight row taps...
    const chosen = [0, 2, 4, 6, 8, 10, 12, 14];
    let taps = 0;
    for (const index of chosen) {
      taps += 1;
      await toggle(page, index).click();
    }
    await expect(page.getByTestId("checklist-add")).toHaveText("Add 8 selected");
    // ...a quantity change (typing, not a tap)...
    await rows(page).nth(2).getByTestId("checklist-quantity").fill("50");
    // ...and one tap on Add selected
    taps += 1;
    await page.getByTestId("checklist-add").dblclick(); // a quick double tap must still add once
    expect(taps).toBe(9);

    await expect(page.getByTestId("order-line")).toHaveCount(8);
    const expected = [1, 3, 5, 7, 9, 11, 13, 15];
    for (const [i, index] of chosen.entries()) {
      await expect(line(page, i).getByTestId("line-name")).toContainText(NAMES[index]!);
      await expect(line(page, i).getByLabel("Quantity")).toHaveValue(index === 2 ? "50" : String(expected[i]));
      await expect(line(page, i).getByLabel("Unit")).toHaveValue("strip");
    }
    await page.waitForTimeout(500);
    await expect(page.getByTestId("order-line")).toHaveCount(8);
    await waitSaved(page);

    // the added rows show "On order", cannot be selected, and nothing is selected any more
    for (const index of chosen) {
      await expect(rows(page).nth(index)).toHaveAttribute("data-on-order", "true");
      await expect(rows(page).nth(index)).toHaveAttribute("data-selected", "false");
      await expect(toggle(page, index)).toBeDisabled();
    }
    await expect(page.getByTestId("checklist-add")).toBeDisabled();

    // one save made the draft with exactly eight lines
    const drafts = await freshTenant.client.from("orders").select("id").eq("store_id", storeId).eq("status", "draft");
    expect(drafts.data).toHaveLength(1);
    const stored = await freshTenant.client.from("order_lines").select("id").eq("order_id", drafts.data![0]!.id).is("removed_at", null);
    expect(stored.data).toHaveLength(8);

    // no price, MRP or cost came with the last order
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(body).not.toMatch(/purchase|\bmrp\b|\bcost\b|margin|profit|snapshot/i);

    // one Undo removes exactly those eight lines
    await expect(page.getByTestId("undo-bar")).toContainText("Added 8 lines");
    await page.getByTestId("undo-action").click();
    await expect(page.getByTestId("order-line")).toHaveCount(0);
    await expect(rows(page).nth(0)).toHaveAttribute("data-on-order", "false");
  });

  test("an invalid quantity disables Add and states the range; Select all skips rows on the order; Clear unselects", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await open(page);
    await page.getByTestId("checklist-open").click();
    await expect(rows(page)).toHaveCount(25);

    await toggle(page, 1).click();
    const quantity = rows(page).nth(1).getByTestId("checklist-quantity");
    await expect(quantity).toHaveValue("2");
    for (const bad of ["", "0", "-1", "1.5", "100001", "abc"]) {
      await quantity.fill(bad);
      await expect(page.getByTestId("checklist-add")).toBeDisabled();
      await expect(page.getByTestId("checklist-range")).toContainText("whole number from 1 to 100,000");
    }
    await quantity.fill("7");
    await expect(page.getByTestId("checklist-add")).toBeEnabled();
    await expect(page.getByTestId("checklist-range")).toHaveCount(0);
    await page.getByTestId("checklist-add").click();
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await expect(line(page, 0).getByLabel("Quantity")).toHaveValue("7");

    // select all: 24 rows (the one on the order is skipped); clear: none
    await page.getByTestId("checklist-all").click();
    await expect(page.getByTestId("checklist-add")).toHaveText("Add 24 selected");
    await expect(rows(page).nth(1)).toHaveAttribute("data-selected", "false");
    await page.getByTestId("checklist-clear").click();
    await expect(page.getByTestId("checklist-add")).toBeDisabled();
    for (let i = 0; i < 25; i += 1) await expect(rows(page).nth(i)).toHaveAttribute("data-selected", "false");
  });

  test("with lines already on the order, only the other rows can be chosen", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await open(page);
    await addMedicine(page, "check 05", "Check 05");
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await expect(page.getByTestId("checklist-open")).toBeVisible(); // unlike Repeat, the checklist stays for a draft with lines
    await expect(page.getByTestId("repeat-last-order")).toHaveCount(0);
    await page.getByTestId("checklist-open").click();
    await expect(rows(page)).toHaveCount(25);
    await expect(rows(page).nth(4)).toHaveAttribute("data-on-order", "true");
    await expect(toggle(page, 4)).toBeDisabled();
    await toggle(page, 0).click();
    await toggle(page, 1).click();
    await page.getByTestId("checklist-add").click();
    await expect(page.getByTestId("order-line")).toHaveCount(3);
    await waitSaved(page);
  });

  test("an inactive medicine is not a row and is named in a message; a failing load shows Retry and keeps the order", async ({ page, freshTenant }) => {
    const { ids } = await seed(freshTenant);
    await freshTenant.client.from("products").update({ is_active: false }).eq("id", ids[9]);
    await blockDeviceStorage(page); // this test checks the online failure state, with no copy kept on the device
    await signIn(page, freshTenant);
    let fail = true;
    await page.route(/\/api\/orders\/repeat\?/, (route) => (fail ? route.abort("failed") : route.continue()));
    await open(page);
    await addMedicine(page, "check 03", "Check 03");
    await page.getByTestId("checklist-open").click();
    await expect(page.getByTestId("checklist-error")).toBeVisible();
    await expect(page.getByTestId("order-line")).toHaveCount(1); // the order is kept
    fail = false;
    await page.getByTestId("checklist-error").getByRole("button", { name: "Retry" }).click();
    await expect(rows(page)).toHaveCount(24);
    await expect(page.getByTestId("checklist-skipped")).toContainText("Check 10");
    await expect(page.getByTestId("checklist-skipped")).toContainText("no longer active");
  });

  test("the controls are at least 44 px high with no sideways scroll", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await open(page);
    expect(await smallTargets(page), "small targets before opening").toEqual([]);
    await page.getByTestId("checklist-open").click();
    await expect(rows(page)).toHaveCount(25);
    await toggle(page, 0).click();
    await toggle(page, 3).click();
    await page.getByTestId("checklist-add").scrollIntoViewIfNeeded();
    expect(await smallTargets(page), "small targets in the open checklist").toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(5);
  });
});
