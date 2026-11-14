import { expect, signIn, test } from "./fixtures";
import { seedInvoiceWorld } from "./invoice-helpers";
import { createOrder, seedStore } from "./orders-helpers";
import { todayInPakistan } from "./market-helpers";

// US6 of Module 006: order sheets, option A (one order) and option B (several stores, one section each). Quantities and
// units only, never a price. Checked with print-media emulation; a real printer is NOT used. Mobile project only.
test.describe("US6: order sheets", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("option A prints one order with the business header, the store, the order number and each product with quantity and unit, and no price", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await createOrder(freshTenant, seed.storeId, [
      { product_id: seed.pricedId, quantity: 10, unit: "strip" },
      { product_id: null, name: "Noran 20mg cap", quantity: 4, unit: "strip" },
    ], { confirm: true });
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    await page.getByTestId("print-order-sheet").click();
    await expect(page).toHaveURL(new RegExp(`/orders/${order.id}/print$`));
    await page.emulateMedia({ media: "print" });

    await expect(page.getByTestId("sheet-toolbar")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
    await expect(page.getByTestId("sheet-business")).toContainText("business");
    await expect(page.getByTestId("sheet-title")).toHaveText("Order sheet");
    await expect(page.getByTestId("sheet-section")).toHaveCount(1);
    await expect(page.getByTestId("sheet-store")).toHaveText("Al Madina Medical");
    await expect(page.getByTestId("sheet-order")).toContainText(`ORD-${String(order.number).padStart(4, "0")}`);
    const lines = page.getByTestId("sheet-line");
    await expect(lines).toHaveCount(2);
    await expect(lines.first()).toContainText("Panadol 500mg");
    await expect(lines.first()).toContainText("10 strip");
    await expect(lines.nth(1)).toContainText("Noran 20mg cap");
    await expect(lines.nth(1).getByTestId("sheet-unregistered")).toBeVisible();
    const text = await page.getByTestId("order-sheet").innerText();
    for (const word of ["PKR", "price", "125.50", "90.00", "130.00", "cost", "MRP", "profit"]) expect(text.toLowerCase(), word).not.toContain(word.toLowerCase());
    const pdf = await page.pdf({ format: "A4" });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  test("option B prints the day's orders with one separate, complete section per store, and a store choice limits the sections", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant, "Al Madina Medical");
    const shah = await seedStore(freshTenant, "Shah Medical");
    const rehman = await seedStore(freshTenant, "Rehman Medical");
    await createOrder(freshTenant, seed.storeId, [{ product_id: seed.pricedId, quantity: 20, unit: "strip" }], { confirm: true });
    await createOrder(freshTenant, shah, [{ product_id: seed.pricedId, quantity: 10, unit: "strip" }, { product_id: seed.sellingOnlyId, quantity: 2, unit: "box" }], { confirm: true });
    await createOrder(freshTenant, rehman, [{ product_id: null, name: "Zinnat 250mg", quantity: 5, unit: "strip" }], { confirm: true });
    await createOrder(freshTenant, rehman, [{ product_id: seed.pricedId, quantity: 99, unit: "strip" }]); // a draft: never printed
    await signIn(page, freshTenant);

    await page.goto("/orders");
    await page.getByTestId("order-sheets-link").click();
    await expect(page).toHaveURL(new RegExp(`/orders/print\\?date=${todayInPakistan()}$`));
    await expect(page.getByTestId("sheet-section")).toHaveCount(3);
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("sheet-toolbar")).toBeHidden();
    const sections = page.getByTestId("sheet-section");
    await expect(sections.filter({ hasText: "Al Madina Medical" })).toContainText("20 strip");
    await expect(sections.filter({ hasText: "Al Madina Medical" })).not.toContainText("Brufen");
    await expect(sections.filter({ hasText: "Shah Medical" }).getByTestId("sheet-line")).toHaveCount(2);
    await expect(sections.filter({ hasText: "Rehman Medical" })).toContainText("Zinnat 250mg");
    await expect(sections.filter({ hasText: "Rehman Medical" }).getByTestId("sheet-unregistered")).toBeVisible();
    await expect(sections.filter({ hasText: "Rehman Medical" })).not.toContainText("99");
    const text = await page.getByTestId("order-sheet").innerText();
    for (const word of ["PKR", "price", "125.50", "310.00", "cost", "MRP"]) expect(text.toLowerCase(), word).not.toContain(word.toLowerCase());

    // Choosing stores (screen media) limits the sections and says which stores are included.
    await page.emulateMedia({ media: "screen" });
    await page.getByTestId("store-filter").locator("summary").click();
    await page.getByTestId("store-filter").locator("label").filter({ hasText: "Shah Medical" }).click();
    await expect(page).toHaveURL(/stores=/);
    await expect(page.getByTestId("sheet-section")).toHaveCount(1);
    await expect(page.getByTestId("sheet-title")).toContainText("Shah Medical");
  });

  test("shows an empty state instead of printing a blank sheet", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/orders/print?date=2030-01-01");
    await expect(page.getByRole("heading", { name: "No confirmed orders" })).toBeVisible();
    await expect(page.getByTestId("print-now")).toHaveCount(0);
    await expect(page.getByTestId("sheet-section")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Go to orders" })).toBeVisible();

    const seed = await seedInvoiceWorld(freshTenant);
    const draft = await createOrder(freshTenant, seed.storeId, [{ product_id: seed.pricedId, quantity: 1, unit: "strip" }]);
    await page.goto(`/orders/${draft.id}/print`);
    await expect(page.getByText("Nothing to print")).toBeVisible();
    await expect(page.getByTestId("sheet-section")).toHaveCount(0);
  });
});
