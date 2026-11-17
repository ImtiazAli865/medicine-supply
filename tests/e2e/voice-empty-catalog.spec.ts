import { seedStoreWithClient } from "../helpers/pending";
import { expect, signIn, test } from "./fixtures";
import { installFakeSpeech, openNewOrder, parseWithAi, typeTranscript } from "./voice-helpers";

// Master prompt Section 7A: voice with an empty catalog must still work. Unmatched names become pending (typed) lines,
// shown for correction, and the order can still be created. Mobile project only; the AI is a fake.
test.describe("US2: voice with an empty catalog", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("every medicine becomes a typed line, the draft is created, and the lines can be registered later", async ({ page, freshTenant }) => {
    await seedStoreWithClient(freshTenant.client, "Al Madina Medical");
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await typeTranscript(page, "Al Madina Medical: Panadol 20 strips, Brufen 10 box");
    await parseWithAi(page);

    await expect(page.getByTestId("voice-store")).toHaveAttribute("data-store-state", "matched");
    const lines = page.getByTestId("voice-line");
    await expect(lines).toHaveCount(2);
    for (let i = 0; i < 2; i += 1) {
      await expect(lines.nth(i)).toHaveAttribute("data-line-state", "unknown");
      await expect(lines.nth(i)).toHaveAttribute("data-choice", "typed");
    }
    await expect(page.getByTestId("voice-create")).toBeEnabled();
    await page.getByTestId("voice-create").click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);

    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await expect(page.getByText("Panadol").first()).toBeVisible();
    await expect(page.getByText("Brufen").first()).toBeVisible();
    await expect(page.getByText("Not registered").first()).toBeVisible();
    // the draft can be confirmed with typed lines (they never block confirming)
    await expect(page.getByTestId("confirm-order")).toBeEnabled();
  });
});
