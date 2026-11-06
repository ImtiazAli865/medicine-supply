import { addMedicine, confirmOrder, line, seedMedicines, seedStore, startOrder, waitSaved } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US3: a medicine that is not in the catalog never blocks or loses an order.
test.describe("US3: typed (not registered) lines", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  async function addTyped(page: import("@playwright/test").Page, text: string, quantity: string, unit: string, viaNoneOfThese = false) {
    await page.getByTestId("add-medicine").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Search medicines").fill(text);
    await dialog.getByTestId("add-as-typed").click();
    if (viaNoneOfThese) await expect(dialog.getByLabel("Medicine name")).toHaveValue(text);
    await dialog.getByLabel("Medicine name").fill(text);
    await dialog.getByLabel("Quantity").fill(quantity);
    await dialog.getByLabel("Unit").fill(unit);
    await dialog.getByTestId("add-typed-line").click();
    await expect(dialog).toBeHidden();
  }

  test("a brand-new business with no medicines and no stores can take and confirm a full order of typed lines", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/orders/new");
    await page.getByTestId("add-new-store").click();
    await page.getByLabel("Store name").fill("First Pharmacy");
    await page.getByTestId("save-new-store").click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?store=/);

    await addTyped(page, "Noran 20mg cap", "3", "strip");
    await waitSaved(page);
    await addTyped(page, "Unknown Syrup", "2", "bottle");
    await waitSaved(page);
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await expect(page.getByText("Not registered")).toHaveCount(2);
    await expect(page.getByText("No selling price")).toHaveCount(2);
    await expect(page.getByTestId("line-price")).toHaveCount(0);

    await confirmOrder(page);
    await expect(page.getByText("Not registered")).toHaveCount(2);
    await expect(page.getByText("No selling price")).toHaveCount(2);
    await expect(page.getByTestId("line-price")).toHaveCount(0);
    await expect(page.getByTestId("order-total-amount")).toHaveText("—");
    await expect(page.getByTestId("order-total-note")).toHaveText("2 lines have no selling price");
    await expect(page.getByTestId("line-name").first()).toHaveText("Noran 20mg cap"); // the exact text typed
    const stored = await freshTenant.client.from("order_lines").select("name, item_status, product_id").order("position");
    expect(stored.data).toEqual([
      { name: "Noran 20mg cap", item_status: "pending_registration", product_id: null },
      { name: "Unknown Syrup", item_status: "pending_registration", product_id: null },
    ]);
  });

  test("matches are listed first, and 'None of these, it is a new medicine' is always offered and never forced", async ({ page, freshTenant }) => {
    await seedMedicines(freshTenant);
    await seedStore(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Al Shifa Pharmacy");
    await page.getByTestId("add-medicine").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Search medicines").fill("panadol");
    await expect(dialog.getByTestId("medicine-result")).toHaveCount(1);
    await expect(dialog.getByTestId("add-as-typed")).toHaveText("None of these, it is a new medicine");
    await dialog.getByTestId("add-as-typed").click();
    await expect(dialog.getByLabel("Medicine name")).toHaveValue("panadol");
    await dialog.getByLabel("Medicine name").fill("Panadol Special");
    await dialog.getByLabel("Quantity").fill("4");
    await dialog.getByLabel("Unit").fill("box");
    await dialog.getByTestId("add-typed-line").click();
    await expect(page.getByText("Not registered")).toHaveCount(1);
    await waitSaved(page);
    const stored = await freshTenant.client.from("order_lines").select("product_id, name");
    expect(stored.data).toEqual([{ product_id: null, name: "Panadol Special" }]); // nothing was auto-matched
  });

  test("with no match the typed option names what was typed, and Urdu or mixed text is kept exactly", async ({ page, freshTenant }) => {
    await seedStore(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Al Shifa Pharmacy");
    await page.getByTestId("add-medicine").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Search medicines").fill("پینا ڈول 500mg");
    await expect(dialog.getByTestId("add-as-typed")).toContainText("Add as typed");
    await dialog.getByTestId("add-as-typed").click();
    await dialog.getByLabel("Quantity").fill("2");
    await dialog.getByLabel("Unit").fill("strip");
    await dialog.getByTestId("add-typed-line").click();
    await waitSaved(page);
    await page.reload();
    await expect(page.getByLabel("Medicine name")).toHaveValue("پینا ڈول 500mg");
  });

  test("the same typed text twice shows a warning and keeps both lines", async ({ page, freshTenant }) => {
    await seedStore(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Al Shifa Pharmacy");
    await addTyped(page, "Same Name", "1", "box");
    await addTyped(page, "same   NAME", "2", "box");
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await expect(page.getByTestId("repeated-typed-warning")).toHaveCount(2);
    await waitSaved(page);
  });

  test("a typed line can be edited (name, quantity, unit) before confirming; the exact new text is kept", async ({ page, freshTenant }) => {
    await seedStore(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Al Shifa Pharmacy");
    await addTyped(page, "Wrong Name", "1", "box");
    await waitSaved(page);
    await line(page, 0).getByLabel("Medicine name").fill("  Right   Name ");
    await line(page, 0).getByLabel("Quantity").fill("8");
    await line(page, 0).getByLabel("Unit").fill("carton");
    await waitSaved(page);
    const stored = await freshTenant.client.from("order_lines").select("name, quantity, unit");
    expect(stored.data).toEqual([{ name: "Right Name", quantity: 8, unit: "carton" }]);
    await confirmOrder(page);
    await expect(page.getByTestId("line-qty-unit")).toContainText("8 carton");
  });

  test("catalog and typed lines can be mixed: only the catalog line is priced", async ({ page, freshTenant }) => {
    await seedMedicines(freshTenant);
    await seedStore(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Al Shifa Pharmacy");
    await addMedicine(page, "panadol");
    await addTyped(page, "Not In Catalog", "1", "box");
    await waitSaved(page);
    await confirmOrder(page);
    await expect(page.getByTestId("line-price")).toHaveCount(1);
    await expect(page.getByTestId("order-total-note")).toHaveText("1 line has no selling price");
  });
});
