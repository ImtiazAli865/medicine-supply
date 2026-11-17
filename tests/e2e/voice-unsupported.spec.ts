import { expect, signIn, test } from "./fixtures";
import { installFakeSpeech, openNewOrder, parseWithAi, seedVoiceWorld, typeTranscript } from "./voice-helpers";

// User Story 4 of Module 008: a browser that cannot listen gets an honest message and a working typed box.
test.describe("US4: a browser without speech recognition", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("says so plainly, offers no microphone, and the typed text makes a draft", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page, { unsupported: true });
    await signIn(page, freshTenant);
    await openNewOrder(page);

    await expect(page.getByTestId("voice-unsupported")).toContainText(/cannot listen to speech/);
    await expect(page.getByTestId("voice-unsupported")).toContainText(/keyboard/);
    await expect(page.getByTestId("voice-mic")).toHaveCount(0);
    await expect(page.getByTestId("voice-language")).toHaveCount(0);
    // the rest of the screen works: the manual store list is there and the transcript box is editable
    await expect(page.getByTestId("store-option").first()).toBeVisible();
    await typeTranscript(page, "Al Madina Medical: Brufen 4 box");
    await parseWithAi(page);
    await expect(page.getByTestId("voice-line")).toHaveCount(1);
    await page.getByTestId("voice-create").click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await expect(page.getByTestId("spoken-text-body")).toHaveText("Al Madina Medical: Brufen 4 box");
  });
});
