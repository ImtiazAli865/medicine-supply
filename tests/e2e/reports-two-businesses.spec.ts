import { createTenant, deleteTenant } from "../helpers/supabase-test";
import { expect, signIn, test } from "./fixtures";
import { confirmedOrder, makeInvoice, seedInvoiceWorld } from "./invoice-helpers";
import { seedReportWorld } from "./reports-helpers";

// SC-004 of Module 010: two businesses with different data; each owner sees only their own figures on every report and in
// every export.
test.describe("two businesses", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("each owner sees only their own sales, stores, medicines and balances, also in the CSV", async ({ page, freshTenant }) => {
    await seedReportWorld(freshTenant); // Al Madina Medical, sales 2,805.00
    const other = await createTenant("e2e-other");
    try {
      const seed = await seedInvoiceWorld(other, "Zeta Chemist Only B");
      const order = await confirmedOrder(other, seed, [{ product_id: seed.pricedId, quantity: 3, unit: "strip" }]);
      await makeInvoice(other, order.id, "issued"); // sales 376.50 for the other business

      await signIn(page, freshTenant);
      await page.goto("/reports/sales");
      await expect(page.getByTestId("report-total-sales")).toHaveText("PKR 2,805.00");
      await page.goto("/reports/stores");
      await expect(page.getByTestId("report-rows")).toContainText("Al Madina Medical");
      await expect(page.getByTestId("report-rows")).not.toContainText("Zeta Chemist Only B");
      await page.goto("/reports/balances");
      await expect(page.getByTestId("balances-total-owed")).toHaveText("PKR 2,805.00");
      await expect(page.getByTestId("account-list")).not.toContainText("Zeta Chemist Only B");

      for (const report of ["sales", "stores", "medicines", "cost-missing", "balances", "purchases"]) {
        const res = await page.request.get(`/api/reports/export?report=${report}&from=2026-01-01&to=${new Date().toISOString().slice(0, 10)}`);
        expect(res.status(), report).toBe(200);
        const text = await res.text();
        expect(text, report).not.toContain("Zeta Chemist Only B");
        expect(text, report).not.toContain("376.50");
      }

      // The other owner sees only theirs.
      await page.context().clearCookies();
      await signIn(page, other);
      await page.goto("/reports/sales");
      await expect(page.getByTestId("report-total-sales")).toHaveText("PKR 376.50");
      await page.goto("/reports/stores");
      await expect(page.getByTestId("report-rows")).not.toContainText("Al Madina Medical");
    } finally {
      await deleteTenant(other);
    }
  });

  test("a crafted address cannot show another business's data", async ({ page, freshTenant }) => {
    await seedReportWorld(freshTenant);
    await signIn(page, freshTenant);
    // There is no id in a report address, so a forged store or business id is simply ignored.
    await page.goto("/reports/stores?store_id=11111111-1111-1111-1111-111111111111&business_id=22222222-2222-2222-2222-222222222222");
    await expect(page.getByTestId("report-rows")).toContainText("Al Madina Medical");
    const res = await page.request.get("/api/reports/stores?from=2026-01-01&to=2026-11-30&business_id=22222222-2222-2222-2222-222222222222");
    expect(res.status()).toBe(200);
    expect(JSON.stringify(await res.json())).toContain("Al Madina Medical");
  });
});
