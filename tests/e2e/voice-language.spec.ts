import { expect, signIn, test } from "./fixtures";
import { installFakeSpeech, openNewOrder, seedVoiceWorld, speak } from "./voice-helpers";

// User Story 4 of Module 008: choose the spoken language and learn honestly what works. The speech engine is a fake in
// the page; no audio exists. Mobile project only.
type FakeSpeech = { calls: Array<{ type: string; lang?: string }>; say(t: string, f?: boolean): boolean; fail(n: string): boolean; finish(): boolean };
const fake = (page: import("@playwright/test").Page) => page.evaluate(() => (window as unknown as { __fakeSpeech: FakeSpeech }).__fakeSpeech.calls.slice());

const noAudioScript = `
  window.__gum = 0; window.__recorders = 0;
  try { const md = navigator.mediaDevices; if (md && md.getUserMedia) { const orig = md.getUserMedia.bind(md); md.getUserMedia = (...a) => { window.__gum += 1; return orig(...a); }; } } catch (e) {}
  window.MediaRecorder = class { constructor() { window.__recorders += 1; } };
`;

test.describe("US4: language and honest support", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("the language choice is remembered after a reload and the engine is asked for it", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await expect(page.getByTestId("voice-language")).toHaveValue("en");
    await page.getByTestId("voice-language").selectOption("ur");
    await page.reload();
    await expect(page.getByTestId("voice-panel")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("voice-language")).toHaveValue("ur");

    await page.getByTestId("voice-mic").click();
    await expect(page.getByTestId("voice-listening")).toBeVisible();
    expect((await fake(page)).filter((c) => c.type === "start").map((c) => c.lang)).toEqual(["ur-PK"]);
    await page.evaluate(() => (window as unknown as { __fakeSpeech: FakeSpeech }).__fakeSpeech.finish());

    await page.getByTestId("voice-language").selectOption("en");
    await page.getByTestId("voice-mic").click();
    await expect(page.getByTestId("voice-listening")).toBeVisible();
    expect((await fake(page)).filter((c) => c.type === "start").map((c) => c.lang)).toEqual(["ur-PK", "en-PK"]);
  });

  test("English falls back once to en-US when the browser does not support en-PK, and says so", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page, { unsupportedLangs: ["en-PK"] });
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await page.getByTestId("voice-mic").click();
    await expect(page.getByTestId("voice-listening")).toBeVisible();
    await expect(page.getByText(/general English/)).toBeVisible();
    expect((await fake(page)).filter((c) => c.type === "start").map((c) => c.lang)).toEqual(["en-PK", "en-US"]);
    await expect(page.getByTestId("voice-listen-error")).toHaveCount(0);
  });

  test("Urdu that the browser does not support shows a plain message and the typed box still works", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page, { unsupportedLangs: ["ur-PK"] });
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await page.getByTestId("voice-language").selectOption("ur");
    await page.getByTestId("voice-mic").click();
    await expect(page.getByTestId("voice-listen-error")).toContainText(/does not support listening in the chosen language/);
    expect((await fake(page)).filter((c) => c.type === "start").map((c) => c.lang)).toEqual(["ur-PK"]);
    await page.getByTestId("voice-transcript").fill("Al Madina Medical: Brufen 4 box");
    await expect(page.getByTestId("voice-parse")).toBeEnabled();
  });

  test("each listening problem shows its own message with Try again and typing, and never promises offline or universal support", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    const problems: Array<[string, RegExp]> = [
      ["not-allowed", /microphone is blocked/],
      ["no-speech", /Nothing was heard/],
      ["network", /needs a connection/],
      ["audio-capture", /No microphone was found/],
      ["service-not-allowed", /does not allow speech recognition/],
    ];
    for (const [name, message] of problems) {
      await page.getByTestId("voice-mic").click();
      await expect(page.getByTestId("voice-listening")).toBeVisible();
      await page.evaluate((n) => (window as unknown as { __fakeSpeech: FakeSpeech }).__fakeSpeech.fail(n), name);
      await expect(page.getByTestId("voice-listen-error")).toContainText(message);
      await expect(page.getByTestId("voice-listen-retry")).toBeVisible();
      await expect(page.getByTestId("voice-transcript")).toBeEditable();
    }
    await expect(page.getByTestId("voice-audio-note")).toContainText(/may process your voice/);
    await expect(page.getByTestId("voice-audio-note")).toContainText(/does not record or keep audio/);
    await expect(page.locator("body")).not.toContainText(/works offline|works on every|any phone/i);
  });

  test("listening shows a large Stop button and the words as they arrive, and the app never records audio", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await page.addInitScript({ content: noAudioScript });
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await page.getByTestId("voice-mic").click();
    await expect(page.getByTestId("voice-listening")).toBeVisible();
    const box = await page.getByTestId("voice-stop").boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    await page.evaluate(() => (window as unknown as { __fakeSpeech: FakeSpeech }).__fakeSpeech.say("Brufen 4 bo", false));
    await expect(page.getByTestId("voice-interim")).toHaveText("Brufen 4 bo");
    await page.evaluate(() => (window as unknown as { __fakeSpeech: FakeSpeech }).__fakeSpeech.say("Brufen 4 box", true));
    await page.getByTestId("voice-stop").click();
    await expect(page.getByTestId("voice-transcript")).toHaveValue("Brufen 4 box");
    expect(await page.evaluate(() => (window as unknown as { __gum: number }).__gum)).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __recorders: number }).__recorders)).toBe(0);
  });

  test("words spoken after typing are added to the typed text", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await page.getByTestId("voice-transcript").fill("Al Madina Medical: Brufen 4 box");
    await speak(page, ", Panadol 2 strips");
    await expect(page.getByTestId("voice-transcript")).toHaveValue("Al Madina Medical: Brufen 4 box , Panadol 2 strips");
  });

  test("Urdu-script text is kept as heard and an unmatched name becomes a typed line", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await page.getByTestId("voice-language").selectOption("ur");
    await speak(page, "Al Madina Medical: پینا ڈول 5 box");
    await expect(page.getByTestId("voice-transcript")).toHaveValue("Al Madina Medical: پینا ڈول 5 box");
    await page.getByTestId("voice-parse").click();
    await expect(page.getByTestId("voice-preview")).toBeVisible({ timeout: 15_000 });
    const line = page.getByTestId("voice-line").first();
    await expect(line.getByTestId("voice-line-spoken")).toHaveText("پینا ڈول");
    await expect(line).toHaveAttribute("data-line-state", "unknown");
  });
});
