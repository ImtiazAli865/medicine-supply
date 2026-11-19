import { seedSimilar } from "../helpers/fast";
import { line, seedStore, startOrder, waitSaved } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// SC-005 of Module 008: several medicines with the same name are never merged, preselected or substituted (mobile, 360 px).
test.describe("US3: similar medicines are never merged or substituted", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("all four strengths, forms and makers are listed with their details, none is chosen for the supplier, and the chosen one is the one that is saved", async ({ page, freshTenant }) => {
    const ids = await seedSimilar(freshTenant.client);
    await seedStore(freshTenant, "Similar Store");
    await signIn(page, freshTenant);
    await startOrder(page, "Similar Store");
    const box = page.getByTestId("fast-search");
    const results = page.getByTestId("medicine-result");

    await box.fill("panadol");
    await expect(results).toHaveCount(4);
    const texts = await results.allInnerTexts();
    expect(texts.some((t) => t.includes("250 mg") && t.includes("tablet") && t.includes("GSK"))).toBe(true);
    expect(texts.some((t) => t.includes("500 mg") && t.includes("syrup") && t.includes("60 ml"))).toBe(true);
    expect(texts.some((t) => t.includes("Other Maker"))).toBe(true);
    // none is highlighted, and Enter adds nothing
    for (let i = 0; i < 4; i += 1) await expect(results.nth(i)).toHaveAttribute("data-highlighted", "false");
    await box.press("Enter");
    await expect(page.getByTestId("fast-chosen")).toHaveCount(0);
    await expect(page.getByTestId("order-line")).toHaveCount(0);

    // the syrup is chosen by a tap: that exact medicine is added, never a lookalike
    await results.filter({ hasText: "syrup" }).first().click();
    await expect(page.getByTestId("fast-chosen")).toContainText("500 mg");
    await expect(page.getByTestId("fast-chosen")).toContainText("syrup");
    await page.getByTestId("fast-quantity").press("Enter");
    // the 250 mg tablet is added next
    await box.fill("panadol 250");
    await expect(results).toHaveCount(1);
    await box.press("Enter");
    await page.getByTestId("fast-quantity").press("Enter");
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await waitSaved(page);

    await expect(line(page, 0)).toContainText("syrup");
    await expect(line(page, 1)).toContainText("250 mg");
    const stored = await freshTenant.client.from("order_lines").select("product_id").order("position");
    expect((stored.data ?? []).map((l) => l.product_id)).toEqual([ids.p500s, ids.p250]);
  });
});
