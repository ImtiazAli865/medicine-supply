import { randomUUID } from "node:crypto";
import { expect, signIn, test } from "./fixtures";
import { confirmedOrder, createDraftFromOrder, FORBIDDEN_PRINT_WORDS, issueDraft, seedInvoiceWorld, setBusinessDetails, setDelivered, saveQuantities } from "./invoice-helpers";
import { createOrder } from "./orders-helpers";

// US3 of Module 006: the invoice on A4 and on a thermal receipt. The print is checked with print-media emulation and a
// generated PDF (a PDF text reader is not installed in this project, so the PDF itself is only checked to be a real,
// non-empty PDF and the printed text is checked in the page under print media). A real printer is NOT used.
test.describe("US3: print the invoice", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  function expectNoForbiddenWords(text: string) {
    expect(text.length).toBeGreaterThan(40); // the check below is only meaningful when the printed text is really there
    for (const word of FORBIDDEN_PRINT_WORDS) expect(text.toLowerCase(), word).not.toContain(word.toLowerCase());
  }

  test("prints A4 with the business details, number, date, store, lines and the grand total, and no money words or application chrome", async ({ page, freshTenant }) => {
    await setBusinessDetails(freshTenant, { phone: "0300-1112223", address: "Main Bazaar, Lahore", thermalMm: 80 });
    const seed = await seedInvoiceWorld(freshTenant);
    await freshTenant.client.from("stores").update({ contact_person: "Mr Ali", phone: "042-111" }).eq("id", seed.storeId);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    const invoiceId = await createDraftFromOrder(page, order.id);
    await setDelivered(page, 0, "8");
    await saveQuantities(page);
    const number = await issueDraft(page);

    await page.goto(`/invoices/${invoiceId}/print?layout=a4`);
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("print-toolbar")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
    const sheet = page.getByTestId("invoice-print");
    await expect(sheet).toHaveAttribute("data-layout", "a4");
    await expect(page.getByTestId("print-business")).toContainText("business");
    await expect(sheet).toContainText("0300-1112223");
    await expect(sheet).toContainText("Main Bazaar, Lahore");
    await expect(page.getByTestId("print-number")).toHaveText(number);
    await expect(page.getByTestId("print-date")).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByTestId("print-store")).toHaveText("Al Madina Medical");
    await expect(sheet).toContainText("Mr Ali");
    const lines = page.getByTestId("print-line");
    await expect(lines).toHaveCount(2);
    await expect(lines.first()).toContainText("Panadol 500mg");
    await expect(lines.first()).toContainText("8 strip");
    await expect(lines.first()).toContainText("PKR 125.50");
    await expect(lines.first().getByTestId("print-line-total")).toHaveText("PKR 1,004.00");
    await expect(page.getByTestId("print-grand-total")).toHaveText("PKR 2,554.00");
    expectNoForbiddenWords(await sheet.innerText());
    await expect(page.getByTestId("print-mark")).toHaveCount(0);

    const pdf = await page.pdf({ format: "A4" });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(2000);
  });

  test("prints a thermal receipt whose page width comes from Settings, with the same facts and no sideways overflow", async ({ page, freshTenant }) => {
    test.setTimeout(150_000); // two layouts, a PDF and two settings saves make this the longest test of the file
    await setBusinessDetails(freshTenant, { phone: "0300-1112223", address: "Main Bazaar, Lahore", thermalMm: 80 });
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    const invoiceId = await createDraftFromOrder(page, order.id);
    const number = await issueDraft(page);

    await page.goto(`/invoices/${invoiceId}/print?layout=thermal`);
    await page.emulateMedia({ media: "print" });
    const sheet = page.getByTestId("invoice-print");
    await expect(sheet).toHaveAttribute("data-layout", "thermal");
    const css = await page.evaluate(() => Array.from(document.querySelectorAll("style")).map((s) => s.textContent ?? "").join("\n"));
    expect(css).toContain("@page { size: 80mm auto; margin: 3mm; }");
    await expect(page.getByTestId("print-number")).toHaveText(number);
    await expect(page.getByTestId("print-line")).toHaveCount(2);
    await expect(page.getByTestId("print-grand-total")).toHaveText("PKR 2,805.00");
    const fit = await sheet.evaluate((el) => ({ over: el.scrollWidth - el.clientWidth, width: el.getBoundingClientRect().width }));
    expect(fit.over).toBeLessThanOrEqual(1);
    // 80 mm paper with 3 mm margins leaves 74 mm = about 280 CSS pixels.
    expect(fit.width).toBeGreaterThan(270);
    expect(fit.width).toBeLessThan(290);
    expectNoForbiddenWords(await sheet.innerText());
    const pdf = await page.pdf({ width: "80mm" });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");

    // Another width in Settings gives another page width.
    await setBusinessDetails(freshTenant, { phone: "0300-1112223", address: "Main Bazaar, Lahore", thermalMm: 58 });
    await page.goto(`/invoices/${invoiceId}/print?layout=thermal`);
    await page.emulateMedia({ media: "print" });
    const css58 = await page.evaluate(() => Array.from(document.querySelectorAll("style")).map((s) => s.textContent ?? "").join("\n"));
    expect(css58).toContain("@page { size: 58mm auto; margin: 3mm; }");
    const narrow = await page.getByTestId("invoice-print").evaluate((el) => ({ over: el.scrollWidth - el.clientWidth, width: el.getBoundingClientRect().width }));
    expect(narrow.over).toBeLessThanOrEqual(1);
    expect(narrow.width).toBeLessThan(215);
  });

  test("does not print a line with delivered 0, and prints only the business name when no details are saved", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    const invoiceId = await createDraftFromOrder(page, order.id);
    await setDelivered(page, 1, "0");
    await saveQuantities(page);
    await issueDraft(page);

    for (const layout of ["a4", "thermal"] as const) {
      await page.goto(`/invoices/${invoiceId}/print?layout=${layout}`);
      await page.emulateMedia({ media: "print" });
      await expect(page.getByTestId("print-line")).toHaveCount(1);
      const text = await page.getByTestId("invoice-print").innerText();
      expect(text).not.toContain("Brufen");
      expect(text).not.toMatch(/undefined|null/);
      expect(text).toContain("business");
    }
  });

  test("marks a draft as a preview without a number, and a cancelled invoice as CANCELLED with its number", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    const draftId = await createDraftFromOrder(page, order.id);
    await page.getByTestId("print-preview").click();
    await expect(page).toHaveURL(/\/print\?layout=a4$/);
    await expect(page.getByTestId("print-mark")).toHaveText("DRAFT, not an invoice");
    await expect(page.getByTestId("print-number")).toHaveText("Draft preview");

    await page.goto(`/invoices/${draftId}`);
    const number = await issueDraft(page);
    await page.getByTestId("cancel-invoice").click();
    await page.getByTestId("cancel-invoice-reason").fill("Wrong store");
    await page.getByTestId("cancel-invoice-confirm").click();
    await expect(page.getByTestId("invoice-cancelled")).toBeVisible();
    await page.getByTestId("print-thermal").click();
    await expect(page.getByTestId("print-mark")).toHaveText("CANCELLED");
    await expect(page.getByTestId("print-number")).toHaveText(number);
  });

  test("keeps every line and the grand total on a 60-line invoice in both layouts, and wraps very long product names", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const ids: string[] = [];
    for (let i = 0; i < 60; i += 1) ids.push(randomUUID());
    const longName = `Extra long medicine name ${"abcdefghij ".repeat(10)}`.trim();
    const rows = ids.map((id, i) => ({ id, name: i === 0 ? longName : `Bulk Medicine ${String(i).padStart(2, "0")}`, unit: "strip", selling_price: "10.00" }));
    const inserted = await freshTenant.client.from("products").insert(rows);
    expect(inserted.error).toBeNull();
    const order = await createOrder(freshTenant, seed.storeId, ids.map((id) => ({ product_id: id, quantity: 2, unit: "strip" })), { confirm: true });
    await signIn(page, freshTenant);
    const invoiceId = await createDraftFromOrder(page, order.id);
    await issueDraft(page);

    for (const layout of ["a4", "thermal"] as const) {
      await page.goto(`/invoices/${invoiceId}/print?layout=${layout}`);
      await page.emulateMedia({ media: "print" });
      await expect(page.getByTestId("print-line")).toHaveCount(60);
      await expect(page.getByTestId("print-grand-total")).toHaveText("PKR 1,200.00");
      const sheet = page.getByTestId("invoice-print");
      const over = await sheet.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(over, `${layout} overflow`).toBeLessThanOrEqual(1);
      // The grand total comes after the last line and is not hidden.
      const last = await page.getByTestId("print-line").last().boundingBox();
      const total = await page.getByTestId("print-grand-total").boundingBox();
      expect(last && total && total.y >= last.y).toBe(true);
      await expect(page.getByTestId("print-line").first()).toContainText("Extra long medicine name");
      const pdf = await page.pdf(layout === "a4" ? { format: "A4" } : { width: "80mm" });
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
      expect(pdf.length).toBeGreaterThan(2000);
    }
  });

  test("reprints the same numbers after the catalog price and the medicine name change", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    const invoiceId = await createDraftFromOrder(page, order.id);
    await issueDraft(page);

    // Print media is set before the page opens, so the text is read the same way both times.
    await page.emulateMedia({ media: "print" });
    const read = async () => {
      await page.goto(`/invoices/${invoiceId}/print?layout=a4`);
      await expect(page.getByTestId("print-grand-total")).toBeVisible();
      return page.getByTestId("invoice-print").innerText();
    };
    const before = await read();
    const changed = await freshTenant.client.from("products").update({ selling_price: "999.00", name: "Renamed medicine" }).eq("id", seed.pricedId);
    expect(changed.error).toBeNull();
    expect(await read()).toBe(before);
  });

  test("takes at most 5 taps from the confirmed order to the printed A4 invoice", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    let taps = 0;
    await page.getByTestId("create-invoice").click(); // 1
    taps += 1;
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
    await page.getByTestId("issue-invoice").click(); // 2
    taps += 1;
    await page.getByTestId("issue-confirm").click(); // 3
    taps += 1;
    await expect(page.getByTestId("invoice-view")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("print-a4").click(); // 4
    taps += 1;
    await page.evaluate(() => {
      (window as unknown as { __printed: number }).__printed = 0;
      window.print = () => {
        (window as unknown as { __printed: number }).__printed += 1;
      };
    });
    await page.getByTestId("print-now").click(); // 5
    taps += 1;
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
    expect(taps).toBeLessThanOrEqual(5);
  });
});
