import { randomUUID } from "node:crypto";
import { expect, signIn, test } from "./fixtures";
import { createOrder } from "./orders-helpers";
import { seedMarketDay } from "./market-helpers";

// US3 of Module 005: the print page and the CSV export. The print is checked with print-media emulation and a
// generated PDF (a PDF text reader is not installed in this project, so the PDF itself is only checked to be a real,
// non-empty PDF and the printed text is checked in the page under print media). A real printer is NOT used.
test.describe("US3: print and CSV export", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  const MONEY_WORDS = ["90.00", "125.50", "130.00", "95.00", "140.00", "70.00", "99.00", "88.50", "PKR", "cost", "profit", "margin", "MRP"];

  test("prints a compact page: header, rows with totals and stores, the unregistered group marked, no application chrome and no money", async ({ page, freshTenant }) => {
    await seedMarketDay(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/market-list/print");
    await page.emulateMedia({ media: "print" });

    await expect(page.getByTestId("print-toolbar")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
    await expect(page.getByTestId("business-name")).toBeHidden();

    await expect(page.getByTestId("print-business")).toContainText("business");
    await expect(page.getByTestId("print-title")).toContainText("Market list ·");
    await expect(page.getByTestId("print-stores")).toHaveText("Stores included: All stores");
    const rows = page.getByTestId("print-rows").getByTestId("print-row");
    await expect(rows).toHaveCount(3);
    const panadol = rows.filter({ hasText: "500 mg" });
    await expect(panadol).toContainText("45 strip");
    for (const store of ["Al Madina", "Rehman Medical", "Shah Medical"]) await expect(panadol).toContainText(store);
    const typed = page.getByTestId("print-unregistered");
    await expect(typed.getByRole("heading", { name: "Not yet registered" })).toBeVisible();
    await expect(typed.getByTestId("print-row")).toContainText("(unregistered)");
    await expect(typed.getByTestId("print-row")).toContainText("10 strip");

    const text = await page.getByTestId("market-print").innerText();
    expect(text).toContain("Panadol"); // the check below is only meaningful when the printed text is really there
    for (const word of MONEY_WORDS) expect(text, word).not.toContain(word);

    const pdf = await page.pdf({ format: "A4" });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(2000);
  });

  test("prints only the selected stores and says which are included", async ({ page, freshTenant }) => {
    const seed = await seedMarketDay(freshTenant);
    await signIn(page, freshTenant);
    await page.goto(`/market-list/print?stores=${seed.stores.alMadina}`);
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("print-stores")).toHaveText("Stores included: Al Madina");
    const text = await page.getByTestId("market-print").innerText();
    expect(text).toContain("Al Madina");
    expect(text).not.toContain("Shah Medical");
    expect(text).not.toContain("Rehman Medical");
    await expect(page.getByTestId("print-rows").getByTestId("print-row")).toHaveCount(2); // Panadol 500 mg and Brufen only
  });

  test("shows the Print and Export buttons on the list, and the print page's own button prints", async ({ page, freshTenant }) => {
    await seedMarketDay(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/market-list");
    await expect(page.getByTestId("market-export")).toBeVisible();
    await page.getByTestId("market-print").click();
    await expect(page).toHaveURL(/\/market-list\/print\?date=/);
    await expect(page.getByTestId("print-now")).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __printed: number }).__printed = 0;
      window.print = () => {
        (window as unknown as { __printed: number }).__printed += 1;
      };
    });
    await page.getByTestId("print-now").click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  });

  test("exports a CSV with one line per medicine and store, unregistered entries marked, and no cost; formula text is neutralised", async ({ page, freshTenant }) => {
    const seed = await seedMarketDay(freshTenant);
    const evil = randomUUID();
    const inserted = await freshTenant.client.from("products").insert({ id: evil, name: "=1+1 Test", unit: "strip" });
    expect(inserted.error).toBeNull();
    await createOrder(freshTenant, seed.stores.alMadina, [{ product_id: evil, quantity: 2, unit: "strip" }], { confirm: true });
    await signIn(page, freshTenant);

    const res = await page.request.get("/api/market-list/export");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toMatch(/attachment; filename="market-list-\d{4}-\d{2}-\d{2}\.csv"/);
    const body = await res.text();
    expect(body.charCodeAt(0)).toBe(0xfeff); // byte order mark
    const lines = body.slice(1).split("\r\n").filter((l) => l !== "");
    expect(lines[0]).toBe("Medicine,Strength,Dosage form,Pack size,Unit,Store,Store quantity,Total requested,Purchased,Remaining,Status,Registered");
    expect(lines).toContain("Panadol,500 mg,tablet,,strip,Al Madina,20,45,0,45,Not bought,registered");
    expect(lines).toContain("Panadol,500 mg,tablet,,strip,Shah Medical,10,45,0,45,Not bought,registered");
    expect(lines.some((l) => l.endsWith(",unregistered") && l.includes("Noran 20mg cap"))).toBe(true);
    expect(lines.some((l) => l.startsWith("'=1+1 Test,"))).toBe(true); // never run as a formula by a spreadsheet
    for (const word of MONEY_WORDS) expect(body, word).not.toContain(word);

    const filtered = await page.request.get(`/api/market-list/export?stores=${seed.stores.shah}`);
    const shahBody = await filtered.text();
    expect(shahBody).toContain("Shah Medical");
    expect(shahBody).not.toContain("Al Madina");
  });

  test("refuses a bad export query with a message instead of a file", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    const res = await page.request.get("/api/market-list/export?date=2026-02-30");
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe("validation_error");
  });
});
