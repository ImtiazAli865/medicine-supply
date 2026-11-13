import type { Page } from "@playwright/test";
import { expect, signIn, test } from "./fixtures";
import { seedMarketDay, type MarketSeed } from "./market-helpers";
import type { TestTenant } from "../helpers/supabase-test";

// US2 of Module 005: recording what was actually bought, in the browser at 360 px.
test.describe("US2: purchase recording", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  const panadolRow = (page: Page) => page.getByTestId("market-row").filter({ hasText: "500 mg" }).filter({ hasText: "Panadol" });
  const progress = (page: Page) => panadolRow(page).getByTestId("market-row-progress");

  async function open(page: Page, tenant: TestTenant) {
    const seed = await seedMarketDay(tenant);
    await signIn(page, tenant);
    await page.goto("/market-list");
    await expect(panadolRow(page)).toHaveCount(1);
    return seed;
  }

  async function record(page: Page, quantity: string, extra: { cost?: string } = {}) {
    await panadolRow(page).getByTestId("record-purchase").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Quantity bought/).fill(quantity);
    if (extra.cost) await dialog.getByLabel(/Cost per unit/).fill(extra.cost);
    await dialog.getByTestId("save-purchase").click();
  }

  async function productCost(tenant: TestTenant, id: string): Promise<string | null> {
    const res = await tenant.client.from("products").select("purchase_price::text").eq("id", id).single();
    return (res.data as { purchase_price: string | null } | null)?.purchase_price ?? null;
  }

  test("records 20 then 10 of 45 and shows partly bought, then Bought all remaining fills the field without saving", async ({ page, freshTenant }) => {
    await open(page, freshTenant);
    await record(page, "20");
    await expect(progress(page)).toHaveText("20 of 45 strip bought, 25 remaining");
    await expect(panadolRow(page)).toContainText("Partly bought");
    await record(page, "10");
    await expect(progress(page)).toHaveText("30 of 45 strip bought, 15 remaining");

    await panadolRow(page).getByTestId("record-purchase").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("bought-all-remaining").click();
    await expect(dialog.getByLabel(/Quantity bought/)).toHaveValue("15");
    await expect(progress(page)).toHaveText("30 of 45 strip bought, 15 remaining"); // nothing saved yet
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(progress(page)).toHaveText("30 of 45 strip bought, 15 remaining"); // still nothing saved

    await panadolRow(page).getByTestId("record-purchase").click();
    await page.getByRole("dialog").getByTestId("bought-all-remaining").click();
    await page.getByRole("dialog").getByTestId("save-purchase").click();
    await expect(panadolRow(page)).toContainText("Fully bought");
    await expect(progress(page)).toHaveText("45 of 45 strip bought");
    await expect(panadolRow(page).getByTestId("record-purchase")).toBeVisible(); // more can still be recorded
  });

  test("shows Bought extra N and never a negative remaining number", async ({ page, freshTenant }) => {
    await open(page, freshTenant);
    await record(page, "50");
    await expect(panadolRow(page)).toContainText("Bought extra");
    await expect(progress(page)).toHaveText("50 of 45 strip bought, 5 extra");
    await panadolRow(page).getByTestId("record-purchase").click();
    await expect(page.getByRole("dialog").getByTestId("bought-all-remaining")).toHaveCount(0); // nothing remains
  });

  test("refuses an invalid quantity with a message at the field and keeps what was typed", async ({ page, freshTenant }) => {
    await open(page, freshTenant);
    await panadolRow(page).getByTestId("record-purchase").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Quantity bought/).fill("0");
    await dialog.getByLabel(/Supplier or market/).fill("Karachi Market");
    await dialog.getByTestId("save-purchase").click();
    await expect(dialog.getByText("Enter a whole number from 1 to 100,000.")).toBeVisible();
    await expect(dialog.getByLabel(/Supplier or market/)).toHaveValue("Karachi Market");
    await dialog.getByLabel(/Quantity bought/).fill("12.5");
    await dialog.getByTestId("save-purchase").click();
    await expect(dialog.getByText("Enter a whole number from 1 to 100,000.")).toBeVisible();
    await expect(progress(page)).toHaveText("Nothing bought yet, 45 strip to buy");
  });

  test("says which day's list a purchase counts for when the date is not the list date", async ({ page, freshTenant }) => {
    await open(page, freshTenant);
    await panadolRow(page).getByTestId("record-purchase").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/This purchase will count for/)).toHaveCount(0);
    const yesterday = new Date(Date.now() + 5 * 3600_000 - 86_400_000).toISOString().slice(0, 10);
    await dialog.getByLabel("Purchase date").fill(yesterday);
    await expect(dialog.getByText(/This purchase will count for .+, not for .+\./)).toBeVisible();
  });

  test("cancels an entry with a reason: it stops counting, and stays in the history", async ({ page, freshTenant }) => {
    await open(page, freshTenant);
    await record(page, "30");
    await record(page, "5");
    await expect(progress(page)).toHaveText("35 of 45 strip bought, 10 remaining");

    await panadolRow(page).getByTestId("purchase-history-open").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("purchase-entry")).toHaveCount(2);
    await dialog.getByTestId("purchase-entry").first().getByTestId("cancel-entry").click(); // the newest: 5
    await dialog.getByTestId("confirm-cancel-entry").click();
    await expect(dialog.getByText("Write why this entry is cancelled.")).toBeVisible(); // an empty reason is refused
    await dialog.getByLabel("Reason").fill("Typed the wrong number");
    await dialog.getByTestId("confirm-cancel-entry").click();
    await expect(dialog.getByTestId("purchase-void-reason")).toContainText("Typed the wrong number");
    await expect(dialog.getByTestId("purchase-entry")).toHaveCount(2); // the cancelled entry stays listed
    await expect(dialog.locator('[data-cancelled="true"]')).toHaveCount(1);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(progress(page)).toHaveText("30 of 45 strip bought, 15 remaining");
  });

  test("a double tap on Save records exactly one entry", async ({ page, freshTenant }) => {
    await open(page, freshTenant);
    await page.route("**/api/purchases", async (route) => {
      if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    await panadolRow(page).getByTestId("record-purchase").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Quantity bought/).fill("12");
    await dialog.getByTestId("save-purchase").dblclick();
    await expect(progress(page)).toHaveText("12 of 45 strip bought, 33 remaining");
    const entries = await freshTenant.client.from("purchase_entries").select("id").eq("quantity", 12);
    expect(entries.data).toHaveLength(1);
  });

  test("asks before changing the medicine's purchase price: No keeps it, Yes updates it", async ({ page, freshTenant }) => {
    const seed: MarketSeed = await open(page, freshTenant);
    expect(await productCost(freshTenant, seed.panadol500)).toBe("90.00");

    await record(page, "5", { cost: "88.5" });
    await expect(page.getByTestId("update-cost-offer")).toContainText("Update the current purchase price");
    await page.getByTestId("keep-cost").click();
    await expect(page.getByTestId("update-cost-offer")).toHaveCount(0);
    expect(await productCost(freshTenant, seed.panadol500)).toBe("90.00"); // unchanged

    await record(page, "5", { cost: "89" });
    await page.getByTestId("update-cost-yes").click();
    await expect(page.getByTestId("update-cost-offer")).toHaveCount(0);
    await expect.poll(() => productCost(freshTenant, seed.panadol500)).toBe("89.00");
    // The selling price and the order prices are untouched.
    const product = await freshTenant.client.from("products").select("selling_price::text").eq("id", seed.panadol500).single();
    expect((product.data as { selling_price: string }).selling_price).toBe("125.50");
  });

  test("never shows a cost on the list rows after a purchase with a cost", async ({ page, freshTenant }) => {
    await open(page, freshTenant);
    await record(page, "5", { cost: "88.5" });
    await page.getByTestId("keep-cost").click();
    await expect(progress(page)).toHaveText("5 of 45 strip bought, 40 remaining");
    const text = await page.getByTestId("market-rows").innerText();
    for (const value of ["88.50", "PKR"]) expect(text, value).not.toContain(value);
  });

  test("a typed row has no purchase button and a Register link that opens the Pending screen on that text", async ({ page, freshTenant }) => {
    await open(page, freshTenant);
    const typed = page.getByTestId("market-typed-row");
    await expect(typed.getByTestId("record-purchase")).toHaveCount(0);
    const href = await typed.getByTestId("register-link").getAttribute("href");
    expect(href).toContain("/pending?tab=register&q=");
    await typed.getByTestId("register-link").click();
    await expect(page).toHaveURL(/\/pending\?tab=register/);
    await expect(page.getByRole("searchbox", { name: "Search typed medicines" })).toHaveValue("Noran 20mg cap");
    await expect(page.getByTestId("typed-group")).toHaveCount(1);
  });
});
