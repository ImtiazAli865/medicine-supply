import { expect, signIn, test } from "./fixtures";
import { confirmOrder } from "./orders-helpers";
import { EXAMPLE_SENTENCE, clearFakeGeminiRequests, fakeGeminiRequests, installFakeSpeech, openNewOrder, parseWithAi, seedVoiceWorld, speak } from "./voice-helpers";

// User Story 1 of Module 008: speak an order, review it, and get a draft order. Mobile project only; the speech engine
// and Gemini are fakes, so no real service is called.
test.describe("US1: speak an order and create a draft", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("the example sentence becomes a checked preview and one draft order (source voice, nothing confirmed)", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await clearFakeGeminiRequests();
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);

    let taps = 0;
    await speak(page, EXAMPLE_SENTENCE);
    await expect(page.getByTestId("voice-transcript")).toHaveValue(EXAMPLE_SENTENCE);

    taps += 1; // Parse
    await parseWithAi(page);
    await expect(page.getByTestId("voice-store")).toHaveAttribute("data-store-state", "matched");
    await expect(page.getByTestId("voice-store-name")).toHaveText("Al Madina Medical");
    const lines = page.getByTestId("voice-line");
    await expect(lines).toHaveCount(3);
    for (let i = 0; i < 3; i += 1) await expect(lines.nth(i)).toHaveAttribute("data-choice", "catalog");
    await expect(lines.nth(0).getByTestId("voice-quantity")).toHaveValue("20");
    await expect(lines.nth(1).getByTestId("voice-quantity")).toHaveValue("10");
    await expect(lines.nth(2).getByTestId("voice-quantity")).toHaveValue("5");
    await expect(page.getByTestId("voice-transcript-readonly")).toHaveText(EXAMPLE_SENTENCE);
    await expect(page.getByTestId("voice-create")).toBeEnabled();

    taps += 1; // Create draft order
    await page.getByTestId("voice-create").click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
    expect(taps).toBeLessThanOrEqual(5);

    // a normal draft order with its read-only spoken text; nothing confirmed or priced by creating
    await expect(page.getByTestId("order-store")).toContainText("Al Madina Medical");
    await expect(page.getByTestId("order-line")).toHaveCount(3);
    await expect(page.getByTestId("spoken-text-body")).toHaveText(EXAMPLE_SENTENCE);
    await expect(page.getByTestId("confirm-order")).toBeVisible();

    // the request the AI got held only the instruction and the transcript
    // (the fake service's log is shared by tests that run at the same time, so only this test's own request is counted)
    const requests = (await fakeGeminiRequests()).filter((r) => JSON.stringify(r.body).includes(EXAMPLE_SENTENCE));
    expect(requests).toHaveLength(1);
    const body = requests[0].body as { contents: Array<{ parts: Array<{ text: string }> }> };
    expect(body.contents[0].parts[0].text).toBe(EXAMPLE_SENTENCE);

    // it is an ordinary order afterwards: it can be confirmed
    await confirmOrder(page);
    await expect(page.getByTestId("spoken-text-body")).toHaveText(EXAMPLE_SENTENCE);
  });

  test("tapping Create twice quickly, and reloading, leave exactly one order", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await speak(page, EXAMPLE_SENTENCE);
    await parseWithAi(page);
    await page.getByTestId("voice-create").dblclick();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
    await page.reload();
    await expect(page.getByTestId("order-line")).toHaveCount(3);
    await page.goto("/orders");
    await expect(page.getByTestId("order-list-item")).toHaveCount(1);
  });

  test("a create that fails once keeps the preview, and the retry makes exactly one order", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await speak(page, EXAMPLE_SENTENCE);
    await parseWithAi(page);

    let blocked = false;
    await page.route("**/api/orders/*", async (route) => {
      if (route.request().method() === "PUT" && !blocked) {
        blocked = true;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    await page.getByTestId("voice-create").click();
    await expect(page.getByTestId("voice-preview")).toBeVisible();
    await expect(page.getByText(/A connection is needed/)).toBeVisible();
    expect(blocked).toBe(true);
    await page.getByTestId("voice-create").click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
    await page.goto("/orders");
    await expect(page.getByTestId("order-list-item")).toHaveCount(1);
  });

  test("a refresh on the preview restores the transcript and the preview in the same tab and creates nothing", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await speak(page, EXAMPLE_SENTENCE);
    await parseWithAi(page);
    await page.reload();
    await expect(page.getByTestId("voice-preview")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("voice-transcript-readonly")).toHaveText(EXAMPLE_SENTENCE);
    await expect(page.getByTestId("voice-line")).toHaveCount(3);
    await page.goto("/orders");
    await expect(page.getByTestId("order-list-item")).toHaveCount(0);
  });

  test("the transcript box alone works: typing the sentence makes the same preview", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await page.getByTestId("voice-transcript").fill("Al Madina Medical: Brufen 4 box");
    await parseWithAi(page);
    await expect(page.getByTestId("voice-line")).toHaveCount(1);
    await expect(page.getByTestId("voice-line-spoken")).toHaveText("Brufen");
  });
});
