import { expect, signIn, test } from "./fixtures";
import { seedReportWorld } from "./reports-helpers";

// US1 of Module 010: the owner sees sales and both profit figures, each honestly labelled, and can find what is missing.
test.describe("US1: sales and profit, honestly", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("shows the sales, the two profit figures with their labels, what was left out and what has no cost", async ({ page, freshTenant }) => {
    await seedReportWorld(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/reports");
    await expect(page.getByTestId("reports-internal-note")).toContainText("never appear on invoices");
    await page.getByRole("link", { name: /Sales and profit/ }).click();
    await expect(page).toHaveURL(/\/reports\/sales/);

    await expect(page.getByTestId("report-total-sales")).toHaveText("PKR 2,805.00");
    await expect(page.getByTestId("report-total-invoices")).toContainText("1 invoice");
    await expect(page.getByTestId("report-excluded")).toHaveText("1 cancelled invoice and 1 draft invoice are not counted.");

    const realized = page.getByTestId("report-realized");
    await expect(realized.getByTestId("realized-profit")).toHaveText("PKR 455.00");
    await expect(realized.getByTestId("report-status")).toHaveAttribute("data-status", "incomplete");
    await expect(realized.getByTestId("report-status")).toContainText("Realized · Incomplete");
    await expect(realized.getByTestId("report-missing")).toContainText("1 line (PKR 1,550.00 of sales) has no cost");

    const estimated = page.getByTestId("report-estimated");
    await expect(estimated.getByTestId("estimated-profit")).toHaveText("PKR 355.00");
    await expect(estimated.getByTestId("report-status")).toContainText("Estimate · Incomplete");
    await expect(page.getByTestId("report-series").getByTestId("report-row")).toHaveCount(1);
  });

  test("gives the same total in a day, a week and a month grouping", async ({ page, freshTenant }) => {
    await seedReportWorld(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/reports/sales");
    await expect(page.getByTestId("report-total-sales")).toHaveText("PKR 2,805.00");
    for (const group of ["Week", "Month", "Day"]) {
      await page.getByTestId("report-group").getByRole("button", { name: group, exact: true }).click();
      await expect(page.getByTestId("report-group").getByRole("button", { name: group, exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("report-total-sales")).toHaveText("PKR 2,805.00");
      await expect(page.getByTestId("report-series").getByTestId("report-row")).toHaveCount(1);
    }
  });

  test("lists the medicine that has no cost, with links to fix it, and the report changes nothing", async ({ page, freshTenant }) => {
    const world = await seedReportWorld(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/reports/sales");
    await page.getByTestId("report-realized").getByTestId("report-missing-link").click();
    await expect(page).toHaveURL(/\/reports\/cost-missing/);

    await expect(page.getByTestId("cost-missing-row")).toHaveCount(1); // Panadol has both costs, Brufen has neither
    const row = page.getByTestId("cost-missing-row").first();
    await expect(row).toContainText("Brufen 400mg");
    await expect(row).toContainText("PKR 1,550.00");
    await expect(row).toContainText("Estimate: no cost");
    await expect(row).toContainText("Realized: no cost");
    await expect(row.getByTestId("cost-missing-date-link")).toHaveCount(1);

    await row.getByRole("link", { name: "Set a purchase price" }).click();
    await expect(page).toHaveURL(new RegExp(`/products/${world.sellingOnlyId}`));
    // Nothing was changed by looking: the invoice and its total are as they were.
    const invoices = await freshTenant.client.from("invoices").select("status, grand_total");
    expect(invoices.data?.filter((i) => i.status === "issued")).toHaveLength(1);
  });

  test("keeps the period in the address, so a reload shows the same period", async ({ page, freshTenant }) => {
    await seedReportWorld(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/reports/sales");
    await page.getByTestId("report-period").getByRole("button", { name: "Today" }).click();
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
    await expect(page.getByTestId("report-total-sales")).toHaveText("PKR 2,805.00");
    await page.reload();
    await expect(page.getByTestId("report-period").getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("report-total-sales")).toHaveText("PKR 2,805.00");

    // A period before anything was sold is an honest empty state, not zeros.
    await page.getByTestId("report-from").fill("2020-01-01");
    await page.getByTestId("report-to").fill("2020-01-31");
    await expect(page.getByTestId("report-empty")).toContainText("No issued invoices in this period");
    await expect(page.getByTestId("report-total-sales")).toHaveCount(0);
  });

  test("refuses a bad period with a message and does not send it", async ({ page, freshTenant }) => {
    await seedReportWorld(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/reports/sales");
    await expect(page.getByTestId("report-total-sales")).toBeVisible();
    await page.getByTestId("report-from").fill("2026-11-20");
    await page.getByTestId("report-to").fill("2026-11-01");
    await expect(page.getByTestId("report-period-error")).toContainText("The end date is before the start date.");
    await expect(page.getByTestId("report-total-sales")).toBeVisible(); // the last good period stays on screen
  });
});
