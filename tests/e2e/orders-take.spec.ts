import { addMedicine, confirmOrder, line, seedMedicines, seedStore, setQuantity, startOrder, waitSaved } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US1: taking a manual order for a store, on a phone-sized screen.
test.describe("US1: take a manual order", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("add a store on the spot, take three lines, edit, remove, add a note and confirm", async ({ page, freshTenant }) => {
    await seedMedicines(freshTenant);
    await signIn(page, freshTenant);

    // No store exists: the order starts with "Add your first store".
    await page.getByRole("link", { name: "New order" }).first().click();
    await expect(page).toHaveURL(/\/orders\/new$/);
    await expect(page.getByTestId("no-stores")).toBeVisible();
    await page.getByTestId("add-new-store").click();
    await expect(page.getByLabel("Store name")).toBeVisible();
    await page.getByLabel("Store name").fill("Al Shifa Pharmacy");
    await page.getByTestId("save-new-store").click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?store=/);
    await expect(page.getByTestId("order-store")).toContainText("Al Shifa Pharmacy");
    await expect(page.getByTestId("order-heading")).toHaveText("New order");
    await expect(page.getByTestId("no-lines")).toBeVisible();
    await expect(page.getByTestId("confirm-order")).toBeDisabled();

    // Three catalog lines; the first change creates the draft.
    await addMedicine(page, "pan", "Panadol 500mg");
    await waitSaved(page);
    await expect(page.getByTestId("order-heading")).toHaveText("ORD-0001");
    await addMedicine(page, "brufen", "Brufen 400mg");
    await addMedicine(page, "calpol", "Calpol Syrup");
    await expect(page.getByTestId("order-line")).toHaveCount(3);

    // Edit a quantity and a unit, remove a line, add a note.
    await setQuantity(page, 0, "12");
    await line(page, 1).getByLabel("Unit").fill("carton");
    await page.getByRole("button", { name: "Remove Calpol Syrup" }).click();
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await page.getByLabel("Order notes (optional)").fill("Deliver before noon");
    await waitSaved(page);

    await confirmOrder(page);
    await expect(page.getByTestId("order-heading")).toHaveText("ORD-0001");
    await expect(page.getByTestId("order-store")).toContainText("Al Shifa Pharmacy");
    await expect(page.getByTestId("order-notes")).toHaveText("Deliver before noon");
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await expect(line(page, 0).getByTestId("line-qty-unit")).toContainText("12 strip");
    await expect(line(page, 1).getByTestId("line-qty-unit")).toContainText("1 carton");
    await expect(page.getByText("Calpol Syrup")).toHaveCount(0);
  });

  test("no medicine can be added before a store is chosen", async ({ page, freshTenant }) => {
    await seedStore(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/orders/new");
    await expect(page.getByTestId("store-option")).toHaveCount(1);
    await expect(page.getByTestId("add-medicine")).toHaveCount(0);
    await expect(page.getByTestId("confirm-order")).toHaveCount(0);
  });

  test("a store with the same name is offered instead of creating a duplicate", async ({ page, freshTenant }) => {
    await seedStore(freshTenant, "Al Madina Medical");
    await signIn(page, freshTenant);
    await page.goto("/orders/new");
    await page.getByTestId("add-new-store").click();
    await page.getByLabel("Store name").fill("  al   MADINA medical ");
    await page.getByTestId("save-new-store").click();
    await expect(page.getByText("A store with this name already exists")).toBeVisible();
    await expect(page).toHaveURL(/\/orders\/new$/);
    const stores = await freshTenant.client.from("stores").select("id");
    expect(stores.data).toHaveLength(1);
    await page.getByTestId("store-option").filter({ hasText: "Al Madina Medical" }).last().click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?store=/);
  });

  test("selecting a medicine that is already on the order shows that line and adds a second only on request", async ({ page, freshTenant }) => {
    await seedMedicines(freshTenant);
    await seedStore(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Al Shifa Pharmacy");
    await addMedicine(page, "panadol");
    await addMedicine(page, "panadol");
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await expect(page.getByText("is already in this order")).toBeVisible();
    await page.getByTestId("add-separate-line").click();
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await waitSaved(page);
  });

  test("an edit typed a moment before Confirm is saved first and is not lost", async ({ page, freshTenant }) => {
    await seedMedicines(freshTenant);
    await seedStore(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Al Shifa Pharmacy");
    await addMedicine(page, "panadol");
    await waitSaved(page);
    // change the quantity and confirm at once, before the autosave delay has passed
    await setQuantity(page, 0, "7");
    await page.getByTestId("confirm-order").click();
    await page.getByTestId("confirm-order-yes").click();
    await expect(page.getByTestId("order-status")).toContainText("Confirmed", { timeout: 15_000 });
    await expect(line(page, 0).getByTestId("line-qty-unit")).toContainText("7 strip");
  });

  test("an empty catalog says so, and the search still offers to add the medicine as typed", async ({ page, freshTenant }) => {
    await seedStore(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Al Shifa Pharmacy");
    await page.getByTestId("add-medicine").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("catalog-empty")).toContainText("Your catalog is empty");
    await expect(dialog.getByRole("link", { name: "Add a medicine" })).toBeVisible();
    await expect(dialog.getByTestId("add-as-typed")).toBeVisible();
  });

  test("an invalid quantity is flagged on the line and blocks Confirm until it is fixed", async ({ page, freshTenant }) => {
    await seedMedicines(freshTenant);
    await seedStore(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Al Shifa Pharmacy");
    await addMedicine(page, "panadol");
    await waitSaved(page);
    await setQuantity(page, 0, "0");
    await expect(page.getByText("Quantity must be a whole number from 1 to 100,000.")).toBeVisible();
    await expect(page.getByTestId("confirm-order")).toBeDisabled();
    await setQuantity(page, 0, "5");
    await expect(page.getByTestId("confirm-order")).toBeEnabled();
  });
});
