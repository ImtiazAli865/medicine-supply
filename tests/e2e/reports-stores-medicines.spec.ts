import { randomUUID } from "node:crypto";
import { expect, signIn, test } from "./fixtures";
import { makeInvoice } from "./invoice-helpers";
import { createOrder, seedStore } from "./orders-helpers";
import { seedReportWorld } from "./reports-helpers";

// US3 of Module 010: sales by store and by medicine. Medicines that differ in strength are separate rows, search and
// sort work, and every list adds up to the Sales and profit total.
test.describe("US3: sales by store and by medicine", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  async function secondStoreAndStrength(tenant: Parameters<typeof seedReportWorld>[0]) {
    const store = await seedStore(tenant, "Noor Medical");
    const panadol650 = randomUUID();
    const inserted = await tenant.client.from("products").insert({
      id: panadol650, name: "Panadol 500mg", unit: "strip", strength: "650 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK", purchase_price: "95.00", selling_price: "140.00",
    });
    expect(inserted.error).toBeNull();
    const order = await createOrder(tenant, store, [{ product_id: panadol650, quantity: 2, unit: "strip" }], { confirm: true });
    await makeInvoice(tenant, order.id, "issued");
  }

  test("lists each store with its sales and profits, sorted and searched, and adds up to the summary", async ({ page, freshTenant }) => {
    await seedReportWorld(freshTenant);
    await secondStoreAndStrength(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/reports/stores");
    await expect(page.getByTestId("report-totals-sales")).toHaveText("PKR 3,085.00"); // 2,805.00 + 2 x 140.00
    const rows = page.getByTestId("report-rows").getByTestId("report-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Al Madina Medical"); // largest sales first
    await expect(rows.first()).toContainText("PKR 2,805.00");
    await expect(rows.first().getByTestId("report-profits")).toContainText("Realized profit");
    await expect(rows.first().getByTestId("report-profits")).toContainText("Estimated profit");

    await page.getByTestId("report-sort").getByRole("button", { name: "Name", exact: true }).click();
    await expect(rows.first()).toContainText("Al Madina Medical");
    await page.getByTestId("report-search").fill("noor");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Noor Medical");
    await expect(page.getByTestId("report-filter-note")).toContainText("Whole period: PKR 3,085.00");
    await page.getByTestId("report-search").fill("zzz");
    await expect(page.getByTestId("report-empty")).toContainText("No store matches your search");
    await expect(page.getByTestId("report-search")).toBeVisible(); // the box stays so the search can be cleared
  });

  test("keeps different strengths as separate rows and finds a medicine by strength", async ({ page, freshTenant }) => {
    await seedReportWorld(freshTenant);
    await secondStoreAndStrength(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/reports/medicines");
    const rows = page.getByTestId("report-rows").getByTestId("report-row");
    await expect(rows).toHaveCount(3); // Panadol 500 mg, Panadol 650 mg and Brufen
    await expect(page.getByTestId("report-totals-sales")).toHaveText("PKR 3,085.00");
    await expect(rows.filter({ hasText: "500 mg" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "650 mg" })).toHaveCount(1);
    await page.getByTestId("report-search").fill("650");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("650 mg");
    await expect(page.getByTestId("report-filtered-totals-sales")).toHaveText("PKR 280.00");
    await expect(page.getByTestId("report-filter-note")).toContainText("only the rows that match");
  });
});
