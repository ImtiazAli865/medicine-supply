import { expect, signIn, test } from "./fixtures";
import { confirmedOrder, createDraftFromOrder, editFirstLineQuantity, issueDraft, orderRow, saveQuantities, seedInvoiceWorld, setDelivered } from "./invoice-helpers";

// US2 of Module 006: issue the invoice (number, frozen snapshot, order fulfilled, history). Mobile project (360 px) only.
test.describe("US2: issue the invoice", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("issues a draft: number, date, frozen lines, the order becomes Fulfilled and its history says so", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    await createDraftFromOrder(page, order.id);
    await setDelivered(page, 0, "8");
    await saveQuantities(page);

    await page.getByTestId("issue-invoice").click();
    await expect(page.getByRole("dialog")).toContainText("Issue this invoice?");
    await expect(page.getByTestId("issue-total")).toHaveText("PKR 2,554.00");
    await page.getByTestId("issue-confirm").click();

    await expect(page.getByTestId("invoice-view")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("invoice-heading")).toHaveText("INV-000001");
    await expect(page.getByTestId("invoice-status")).toHaveText("Issued");
    await expect(page.getByTestId("invoice-dates")).toContainText(/Invoice date \d{4}-\d{2}-\d{2}/);
    await expect(page.getByTestId("invoice-business")).toContainText("business");
    await expect(page.getByTestId("invoice-line")).toHaveCount(2);
    await expect(page.getByTestId("invoice-line").first()).toContainText("8 strip × PKR 125.50");
    await expect(page.getByTestId("invoice-grand-total")).toHaveText("PKR 2,554.00");
    // An issued invoice has no edit control at all.
    await expect(page.getByTestId("delivered-input")).toHaveCount(0);
    await expect(page.getByTestId("save-quantities")).toHaveCount(0);
    await expect(page.getByTestId("issue-invoice")).toHaveCount(0);
    await expect(page.getByTestId("discard-invoice")).toHaveCount(0);
    await expect(page.getByTestId("invoice-history-event").first()).toContainText("INV-000001 issued");

    // The order is Fulfilled, links to its invoice, cannot be edited or cancelled, and says so in its history.
    await page.getByTestId("back-to-order").click();
    await expect(page.getByTestId("order-status")).toContainText("Fulfilled");
    await expect(page.getByTestId("view-invoice-label")).toHaveText("View invoice INV-000001");
    await expect(page.getByTestId("edit-order")).toHaveCount(0);
    await expect(page.getByTestId("cancel-order")).toHaveCount(0);
    await expect(page.getByTestId("order-history-log")).toContainText("Invoice INV-000001 issued");
    expect((await orderRow(freshTenant, order.id)).status).toBe("fulfilled");
  });

  test("a second tap or a reload gives the same number and never a new one", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    const invoiceId = await createDraftFromOrder(page, order.id);
    const number = await issueDraft(page);

    const version = (await (await page.request.get(`/api/invoices/${invoiceId}`)).json()).version;
    const again = await page.request.post(`/api/invoices/${invoiceId}/issue`, { data: { expected_version: version } });
    expect(again.status()).toBe(200);
    const body = await again.json();
    expect(body).toMatchObject({ done: true, replayed: true });
    expect(body.invoice.number_label).toBe(number);

    await page.reload();
    await expect(page.getByTestId("invoice-heading")).toHaveText(number);
    // The next invoice continues the sequence.
    const second = await confirmedOrder(freshTenant, seed);
    await createDraftFromOrder(page, second.id);
    expect(await issueDraft(page)).toBe("INV-000002");
  });

  test("refuses issuing while a billed line has no verified price, with the reason, and leaves nothing changed", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed, [
      { product_id: seed.pricedId, quantity: 2, unit: "strip" },
      { product_id: null, name: "Noran 20mg cap", quantity: 3, unit: "strip" },
    ]);
    await signIn(page, freshTenant);
    const invoiceId = await createDraftFromOrder(page, order.id);
    await expect(page.getByTestId("issue-invoice")).toBeDisabled();

    // The server refuses it too, whatever the screen shows.
    const version = (await (await page.request.get(`/api/invoices/${invoiceId}`)).json()).version;
    const refused = await page.request.post(`/api/invoices/${invoiceId}/issue`, { data: { expected_version: version } });
    expect(refused.status()).toBe(422);
    const body = await refused.json();
    expect(body.code).toBe("not_ready");
    expect(body.blockers).toEqual([expect.objectContaining({ name: "Noran 20mg cap", reason: "typed" })]);
    expect((await orderRow(freshTenant, order.id)).status).toBe("confirmed");

    // Leaving the line out (delivered 0) makes the invoice ready.
    await setDelivered(page, 1, "0");
    await saveQuantities(page);
    await expect(page.getByTestId("issue-invoice")).toBeEnabled();
    expect(await issueDraft(page)).toBe("INV-000001");
    await expect(page.getByTestId("invoice-line")).toHaveCount(1);
    await expect(page.getByTestId("invoice-grand-total")).toHaveText("PKR 251.00");
  });

  test("refuses a stale draft with the order-changed message and shows the notice", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    await createDraftFromOrder(page, order.id);

    // The order changes while the draft screen is open: the screen does not know yet, the server does.
    await editFirstLineQuantity(freshTenant, seed, order.id, 12);
    await page.getByTestId("issue-invoice").click();
    await page.getByTestId("issue-confirm").click();
    await expect(page.getByTestId("invoice-error")).toContainText("The order has changed, refresh the draft first.");
    await expect(page.getByTestId("stale-notice")).toBeVisible();
    await expect(page.getByTestId("issue-invoice")).toBeDisabled();
    expect((await orderRow(freshTenant, order.id)).status).toBe("confirmed");
  });

  test("keeps the order uneditable and its invoice printable links after issuing", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const order = await confirmedOrder(freshTenant, seed);
    await signIn(page, freshTenant);
    await createDraftFromOrder(page, order.id);
    await issueDraft(page);
    await expect(page.getByTestId("print-a4")).toBeVisible();
    await expect(page.getByTestId("print-thermal")).toBeVisible();
    await expect(page.getByTestId("cancel-invoice")).toBeVisible();
  });
});
