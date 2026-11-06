import { randomUUID } from "node:crypto";
import { expect, signIn, test } from "./fixtures";
import { seedStore } from "./orders-helpers";

// SC-001 (automated proxy): a typical 10-line order, from "New order" to the confirmed screen, with a catalog
// of 500 medicines. This measures the app at its own speed (the browser fills fields instantly); a person on a
// phone will be slower, so the owner's timed run on a real phone is a separate check.
test.describe("SC-001: a 10-line order with a 500-medicine catalog", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(240_000);

  test("takes and confirms 10 lines well inside 3 minutes", async ({ page, freshTenant }) => {
    await seedStore(freshTenant, "Al Shifa Pharmacy");
    const rows = Array.from({ length: 500 }, (_, i) => ({
      id: randomUUID(),
      name: `Medicine ${String(i + 1).padStart(3, "0")}`,
      unit: "strip",
      strength: `${(i % 20) * 25 + 25} mg`,
      dosage_form: i % 2 === 0 ? "tablet" : "syrup",
      selling_price: `${10 + (i % 90)}.50`,
    }));
    const inserted = await freshTenant.client.from("products").insert(rows);
    expect(inserted.error).toBeNull();

    await signIn(page, freshTenant);
    const started = Date.now();
    await page.getByRole("link", { name: "New order" }).first().click();
    await page.getByTestId("store-option").filter({ hasText: "Al Shifa Pharmacy" }).click();
    for (let n = 1; n <= 10; n++) {
      const name = `Medicine ${String(n * 7).padStart(3, "0")}`;
      await page.getByTestId("add-medicine").click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Search medicines").fill(name);
      await dialog.getByTestId("medicine-result").filter({ hasText: name }).first().click();
      await expect(dialog).toBeHidden();
      await page.getByTestId("order-line").nth(n - 1).getByLabel("Quantity").fill(String(n + 1));
    }
    await page.getByTestId("confirm-order").click();
    await page.getByTestId("confirm-order-yes").click();
    await expect(page.getByTestId("order-status")).toContainText("Confirmed", { timeout: 30_000 });
    const seconds = (Date.now() - started) / 1000;
    console.log(`10-line order with a 500-medicine catalog: ${seconds.toFixed(1)} s from "New order" to Confirmed (automated, instant entry)`);
    await expect(page.getByTestId("order-line")).toHaveCount(10);
    expect(seconds).toBeLessThan(180);
  });
});
