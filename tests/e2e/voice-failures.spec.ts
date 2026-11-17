import { expect, signIn, test } from "./fixtures";
import { clearFakeGeminiRequests, fakeGeminiRequests, installFakeSpeech, openNewOrder, seedVoiceWorld, typeTranscript } from "./voice-helpers";

// User Story 3 of Module 008: a failed voice or AI step never blocks or loses an order. The fake Gemini answers
// according to a marker in the transcript; nothing here calls a real service. Mobile project only.
test.describe("US3: failures never block or lose an order", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  const SENTENCE = "Al Madina Medical: Brufen 4 box";

  const cases: Array<[string, string, RegExp]> = [
    ["the service is busy (HTTP 429)", "[[429]]", /The voice service is busy/],
    ["the answer is not JSON", "[[invalid-json]]", /could not be understood/],
    ["the answer has the wrong shape", "[[wrong-shape]]", /could not be understood/],
    ["the prompt is blocked", "[[blocked]]", /could not be understood/],
    ["the key is refused (HTTP 401)", "[[401]]", /not set up on the server/],
    ["the model is not found (HTTP 404)", "[[404]]", /not set up on the server/],
    ["the service has a server error (HTTP 500)", "[[500]]", /could not be reached/],
  ];

  for (const [label, marker, message] of cases) {
    test(`${label}: its own message, the text is kept, Retry and the fallbacks are offered, and the simple reader completes the order`, async ({ page, freshTenant }) => {
      await seedVoiceWorld(freshTenant);
      await installFakeSpeech(page);
      await signIn(page, freshTenant);
      await openNewOrder(page);
      await typeTranscript(page, `${SENTENCE} ${marker}`);
      await page.getByTestId("voice-parse").click();

      await expect(page.getByTestId("voice-failure")).toContainText(message);
      await expect(page.getByTestId("voice-failure")).not.toContainText(/key|token|secret|googleapis|test-key-sentinel/i);
      await expect(page.getByTestId("voice-transcript")).toHaveValue(`${SENTENCE} ${marker}`);
      await expect(page.getByTestId("voice-retry")).toBeVisible();
      await expect(page.getByTestId("voice-simple-reader")).toBeVisible();
      await expect(page.getByTestId("voice-by-hand")).toBeVisible();
      // manual entry and the navigation keep working
      await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(5);
      await expect(page.getByTestId("store-option").first()).toBeVisible();

      // the same order is completed by the simple reader (the marker is edited out of the kept text)
      await typeTranscript(page, SENTENCE);
      await page.getByTestId("voice-simple-reader").click();
      await expect(page.getByTestId("voice-preview")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("voice-preview")).toContainText("simple reader");
      await page.getByTestId("voice-create").click();
      await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
      await expect(page.getByTestId("order-line")).toHaveCount(1);
    });
  }

  test("no answer within the time limit shows 'took too long' and keeps the text", async ({ page, freshTenant }) => {
    test.setTimeout(90_000);
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await typeTranscript(page, `${SENTENCE} [[slow]]`);
    await page.getByTestId("voice-parse").click();
    await expect(page.getByTestId("voice-failure")).toContainText(/took too long/, { timeout: 30_000 });
    await expect(page.getByTestId("voice-transcript")).toHaveValue(`${SENTENCE} [[slow]]`);
  });

  test("a cut connection shows that a connection is needed, keeps the text, and a Retry works once it is back", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await typeTranscript(page, SENTENCE);
    let offline = true;
    await page.route("**/api/voice/parse", (route) => (offline ? route.abort("failed") : route.continue()));
    await page.getByTestId("voice-parse").click();
    await expect(page.getByTestId("voice-failure")).toContainText(/A connection is needed/);
    await expect(page.getByTestId("voice-transcript")).toHaveValue(SENTENCE);
    offline = false;
    await page.getByTestId("voice-retry").click();
    await expect(page.getByTestId("voice-preview")).toBeVisible({ timeout: 15_000 });
  });

  test("the app's own AI limit refuses with its message, and the simple reader is not counted", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    for (let i = 0; i < 20; i += 1) {
      const res = await freshTenant.client.rpc("voice_parse_allow");
      expect(res.data?.allowed).toBe(true);
    }
    await openNewOrder(page);
    await typeTranscript(page, SENTENCE);
    await page.getByTestId("voice-parse").click();
    await expect(page.getByTestId("voice-failure")).toContainText(/Too many voice requests/);
    await page.getByTestId("voice-simple-reader").click();
    await expect(page.getByTestId("voice-preview")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("voice-line")).toHaveCount(1);
  });

  test("an invented item and a price field show the item against the transcript and never the price", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await typeTranscript(page, `${SENTENCE} [[extra]]`);
    await page.getByTestId("voice-parse").click();
    await expect(page.getByTestId("voice-preview")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("voice-line")).toHaveCount(2);
    await expect(page.getByText("Invented Medicine")).toBeVisible();
    await expect(page.getByTestId("voice-transcript-readonly")).not.toContainText("Invented Medicine");
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/125\.50|130\.00|1\.00 /);
  });

  test("a double tap on Parse sends one request and shows one preview", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await typeTranscript(page, SENTENCE);
    await clearFakeGeminiRequests();
    await page.getByTestId("voice-parse").dblclick();
    await expect(page.getByTestId("voice-preview")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("voice-line")).toHaveCount(1);
    expect(await fakeGeminiRequests()).toHaveLength(1);
  });

  test("'Take this order by hand' keeps what was said readable on the manual order screen, in this tab only", async ({ page, context, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await typeTranscript(page, `${SENTENCE} [[429]]`);
    await page.getByTestId("voice-parse").click();
    await expect(page.getByTestId("voice-failure")).toBeVisible();
    await page.getByTestId("voice-by-hand").click();
    await page.getByTestId("store-option").first().click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}\?store=/);
    const url = page.url();
    await expect(page.getByTestId("what-you-said-body")).toContainText("Brufen 4 box");
    await expect(page.getByTestId("what-you-said")).toContainText("not part of the order");
    await page.reload();
    await expect(page.getByTestId("what-you-said-body")).toBeVisible();

    const other = await context.newPage();
    await other.goto(url);
    await expect(other.getByTestId("order-store")).toBeVisible({ timeout: 15_000 });
    await expect(other.getByTestId("what-you-said")).toHaveCount(0);
    await other.close();

    await page.getByTestId("what-you-said-dismiss").click();
    await expect(page.getByTestId("what-you-said")).toHaveCount(0);
  });
});
