import { seedMedicineWithClient, seedStoreWithClient } from "../helpers/pending";
import type { TestTenant } from "../helpers/supabase-test";
import { expect, signIn, test } from "./fixtures";
import { installFakeSpeech, openNewOrder, parseWithAi, typeTranscript } from "./voice-helpers";

// User Story 2 of Module 008: doubtful items are shown and never guessed. Mobile project only; the AI is a fake.
test.describe("US2: doubts are shown, never guessed", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  async function world(tenant: TestTenant) {
    await seedStoreWithClient(tenant.client, "Al Madina Medical");
    await seedStoreWithClient(tenant.client, "Madina Medical Store");
    await seedMedicineWithClient(tenant.client, { name: "Panadol", brand: "Panadol", strength: "500 mg", dosage_form: "tablet", unit: "strip", selling_price: "125.50" });
    await seedMedicineWithClient(tenant.client, { name: "Panadol", brand: "Panadol", strength: "650 mg", dosage_form: "tablet", unit: "strip", selling_price: "150.00" });
    await seedMedicineWithClient(tenant.client, { name: "Brufen", brand: "Brufen", strength: "400 mg", dosage_form: "tablet", unit: "box", selling_price: "310.00" });
  }

  test("a two-strength name shows Choose one with nothing selected, blocks Create with its reason, and choosing one unblocks it", async ({ page, freshTenant }) => {
    await world(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await typeTranscript(page, "Al Madina Medical: Panadol 20 strips, Brufen 3 box");
    await parseWithAi(page);

    const panadol = page.getByTestId("voice-line").nth(0);
    await expect(panadol).toHaveAttribute("data-line-state", "choose_one");
    await expect(panadol).toHaveAttribute("data-choice", "none");
    await expect(panadol.getByTestId("voice-candidate")).toHaveCount(2);
    await expect(panadol).toContainText("500 mg");
    await expect(panadol).toContainText("650 mg");
    await expect(page.getByTestId("voice-line").nth(1)).toHaveAttribute("data-line-state", "matched");
    await expect(page.getByTestId("voice-create")).toBeDisabled();
    await expect(page.getByTestId("voice-create-reason")).toContainText("Panadol");

    await panadol.getByTestId("voice-candidate").first().click();
    await expect(panadol).toHaveAttribute("data-choice", "catalog");
    await expect(page.getByTestId("voice-create")).toBeEnabled();
    await page.getByTestId("voice-create").click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("order-line")).toHaveCount(2);
  });

  test("'None of these, it is a new medicine' makes a typed line with the exact spoken text, and an unknown name is typed too", async ({ page, freshTenant }) => {
    await world(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await typeTranscript(page, "Al Madina Medical: Panadol 20 strips, Xyzzin 5 box");
    await parseWithAi(page);

    const panadol = page.getByTestId("voice-line").nth(0);
    await panadol.getByTestId("voice-none-of-these").click();
    await expect(panadol).toHaveAttribute("data-choice", "typed");
    await expect(panadol.getByTestId("voice-line-typed")).toContainText("Not registered");
    const xyzzin = page.getByTestId("voice-line").nth(1);
    await expect(xyzzin).toHaveAttribute("data-line-state", "unknown");
    await expect(xyzzin).toHaveAttribute("data-choice", "typed");
    await page.getByTestId("voice-create").click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await expect(page.getByText("Xyzzin").first()).toBeVisible();
    await expect(page.getByText("Panadol").first()).toBeVisible();
    await expect(page.getByText("Not registered").first()).toBeVisible();
  });

  test("a doubtful quantity and a missing unit are flagged and block creation until fixed", async ({ page, freshTenant }) => {
    await world(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await typeTranscript(page, "Al Madina Medical: Brufen 2.5 box, Brufen 4");
    await parseWithAi(page);

    const first = page.getByTestId("voice-line").nth(0);
    await expect(first.getByTestId("voice-quantity")).toHaveValue("");
    await expect(first.locator('[data-flag="quantity_not_whole"]')).toBeVisible();
    const second = page.getByTestId("voice-line").nth(1);
    await expect(second.locator('[data-flag="unit_not_heard"]')).toBeVisible();
    await expect(second.getByTestId("voice-unit")).toHaveValue("box");
    await expect(page.getByTestId("voice-create")).toBeDisabled();
    await expect(page.getByTestId("voice-create-reason")).toContainText("quantity");

    await first.getByTestId("voice-quantity").fill("3");
    await expect(first.locator('[data-flag="quantity_not_whole"]')).toHaveCount(0);
    await expect(page.getByTestId("voice-create")).toBeEnabled();
    // a fraction typed by hand is flagged again and blocks creation, never rounded
    await first.getByTestId("voice-quantity").fill("2.5");
    await expect(first.locator('[data-flag="quantity_not_whole"]')).toBeVisible();
    await expect(page.getByTestId("voice-create")).toBeDisabled();
  });

  test("the same medicine spoken twice stays two lines with a warning", async ({ page, freshTenant }) => {
    await world(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await typeTranscript(page, "Al Madina Medical: Brufen 4 box, Brufen 6 box");
    await parseWithAi(page);
    await expect(page.getByTestId("voice-line")).toHaveCount(2);
    await expect(page.locator('[data-flag="duplicate_spoken"]')).toHaveCount(2);
    await expect(page.getByText("Spoken twice").first()).toBeVisible();
  });

  test("an unknown store offers to choose a store or add one inline, and Create waits for it", async ({ page, freshTenant }) => {
    await world(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await typeTranscript(page, "Zzyzx Clinic: Brufen 4 box");
    await parseWithAi(page);
    await expect(page.getByTestId("voice-store")).toHaveAttribute("data-store-state", "unknown");
    await expect(page.getByTestId("voice-create")).toBeDisabled();
    await expect(page.getByTestId("voice-create-reason")).toContainText("store");

    await page.getByTestId("add-new-store").click();
    await page.getByLabel("Store name").fill("Zzyzx Clinic");
    await page.getByTestId("save-new-store").click();
    await expect(page.getByTestId("voice-store-name")).toHaveText("Zzyzx Clinic");
    await expect(page.getByTestId("voice-create")).toBeEnabled();
  });

  test("a similar store name is offered as Choose one with nothing chosen, and a sentence naming two stores warns", async ({ page, freshTenant }) => {
    await world(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await typeTranscript(page, "Madina: Brufen 4 box");
    await parseWithAi(page);
    await expect(page.getByTestId("voice-store")).toHaveAttribute("data-store-state", "choose_one");
    await expect(page.getByTestId("voice-store-candidate")).toHaveCount(2);
    await expect(page.getByTestId("voice-create")).toBeDisabled();
    await page.getByTestId("voice-store-candidate").first().click();
    await expect(page.getByTestId("voice-store-name")).toBeVisible();
    await expect(page.getByTestId("voice-create")).toBeEnabled();

    await page.getByTestId("voice-start-over").click();
    await page.getByTestId("voice-start-over-confirm").click();
    await typeTranscript(page, "Al Madina and Madina Medical Store: Brufen 4 box");
    await parseWithAi(page);
    await expect(page.getByText(/More than one store was named/)).toBeVisible();
    await expect(page.getByTestId("voice-create")).toBeDisabled();
  });
});
