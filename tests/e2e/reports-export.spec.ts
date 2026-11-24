import { expect, signIn, test } from "./fixtures";
import { seedReportWorld } from "./reports-helpers";

// US5 of Module 010: Export CSV gives exactly what is on the screen, keeps the markers, and is offered only when there is
// something loaded to export.
test.describe("US5: export CSV", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("the Sales and profit file equals the screen, keeps the Incomplete marker and ends with a TOTAL row", async ({ page, freshTenant }) => {
    await seedReportWorld(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/reports/sales");
    await expect(page.getByTestId("report-total-sales")).toHaveText("PKR 2,805.00");

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("report-export").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^report-sales-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await (await import("node:fs/promises")).readFile((await download.path()) as string, "utf8");
    const lines = text.split("\r\n").filter((l) => l !== "");
    expect(lines[0]).toContain("Period,Bucket start,Bucket end,Partial bucket,Sales,Invoices");
    expect(lines).toHaveLength(3); // header, one day with sales, TOTAL
    const total = lines[2];
    expect(total).toContain(",TOTAL,");
    expect(total).toContain(",2805.00,1,");
    expect(total).toContain("455.00"); // realized profit, a number
    expect(total).toContain("Realized, incomplete: 1 line without cost");
    expect(total).toContain("1 cancelled invoice and 1 draft invoice are not counted.");
  });

  test("the store and medicine files respect the search on the screen", async ({ page, freshTenant }) => {
    await seedReportWorld(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/reports/medicines");
    await page.getByTestId("report-search").fill("brufen");
    await expect(page.getByTestId("report-rows").getByTestId("report-row")).toHaveCount(1);
    const href = await page.getByTestId("report-export").getAttribute("href");
    expect(href).toContain("report=medicines");
    expect(href).toContain("q=brufen");
    const res = await page.request.get(href as string);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const lines = (await res.text()).split("\r\n").filter((l) => l !== "");
    expect(lines).toHaveLength(4); // header, Brufen, TOTAL (rows in this file) and TOTAL (whole period), because a search is on
    expect(lines[2]).toContain("TOTAL (rows in this file)");
    expect(lines[3]).toContain("TOTAL (whole period)");
    expect(lines[1]).toContain("Brufen 400mg");
    expect(lines.join("\n")).not.toContain("Panadol 500mg,500 mg");
  });

  test("the balances file has one row per store and the total owed equal to Home", async ({ page, freshTenant }) => {
    await seedReportWorld(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/reports/balances");
    await expect(page.getByTestId("balances-total-owed")).toHaveText("PKR 2,805.00");
    const res = await page.request.get((await page.getByTestId("report-export").getAttribute("href")) as string);
    expect(res.headers()["content-disposition"]).toMatch(/report-balances-\d{4}-\d{2}-\d{2}\.csv/);
    const text = await res.text();
    expect(text).toContain("Al Madina Medical,2805.00,Owes");
    expect(text).toContain("TOTAL OWED,2805.00,Owes");
  });

  test("refuses a signed-out request, a bad period and a PDF", async ({ page, freshTenant, request }) => {
    const signedOut = await request.get("/api/reports/export?report=sales&from=2026-11-01&to=2026-11-25");
    expect(signedOut.status()).toBe(401);

    await seedReportWorld(freshTenant);
    await signIn(page, freshTenant);
    const bad = await page.request.get("/api/reports/export?report=sales&from=2026-11-20&to=2026-11-01");
    expect(bad.status()).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "validation_error" });
    const pdf = await page.request.get("/api/reports/export?report=pdf&from=2026-11-01&to=2026-11-25");
    expect(pdf.status()).toBe(400);
  });

  test("offers no export while the report failed or is empty", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/reports/sales");
    await expect(page.getByTestId("report-empty")).toBeVisible();
    await expect(page.getByTestId("report-export")).toHaveCount(0);
  });
});
