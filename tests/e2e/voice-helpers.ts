import type { Page } from "@playwright/test";
import { seedMedicineWithClient, seedStoreWithClient } from "../helpers/pending";
import type { TestTenant } from "../helpers/supabase-test";
import { EXAMPLE_SENTENCE, fakeSpeechInitScript } from "../helpers/voice";
import { expect } from "./fixtures";

// Shared set-up and steps for the Module 008 browser tests (voice order entry). The speech engine is a fake installed
// in the page; Gemini is a small local fake server started by the Playwright config. No test calls a real service.

export { EXAMPLE_SENTENCE };

const FAKE_GEMINI = `http://127.0.0.1:${process.env.FAKE_GEMINI_PORT ?? 4010}`;

/** Installs the fake browser speech engine before the page loads. */
export async function installFakeSpeech(page: Page, options: { unsupported?: boolean; unsupportedLangs?: string[] } = {}): Promise<void> {
  await page.addInitScript({ content: fakeSpeechInitScript(options) });
}

export interface VoiceWorld {
  storeId: string;
  storeName: string;
  panadol: string;
  brufen: string;
  coughSyrup: string;
}

/** One store and three medicines whose names are exactly what the example sentence says. */
export async function seedVoiceWorld(tenant: TestTenant, storeName = "Al Madina Medical"): Promise<VoiceWorld> {
  const storeId = await seedStoreWithClient(tenant.client, storeName);
  const panadol = await seedMedicineWithClient(tenant.client, { name: "Panadol", unit: "strip", selling_price: "125.50" });
  const brufen = await seedMedicineWithClient(tenant.client, { name: "Brufen", unit: "box", selling_price: "310.00" });
  const coughSyrup = await seedMedicineWithClient(tenant.client, { name: "cough syrup", unit: "bottle", selling_price: "95.00" });
  return { storeId, storeName, panadol, brufen, coughSyrup };
}

/** Opens New order and waits for the voice panel (and for the browser facts to be read). */
export async function openNewOrder(page: Page): Promise<void> {
  await page.goto("/orders/new");
  await expect(page.getByTestId("voice-panel")).toBeVisible({ timeout: 15_000 });
}

/** Starts listening with the fake engine, pushes the words, and stops. The words end up in the transcript box. */
export async function speak(page: Page, text: string): Promise<void> {
  await page.getByTestId("voice-mic").click();
  await expect(page.getByTestId("voice-listening")).toBeVisible();
  const pushed = await page.evaluate((words) => (window as unknown as { __fakeSpeech: { say(t: string, f?: boolean): boolean } }).__fakeSpeech.say(words, true), text);
  expect(pushed).toBe(true);
  await page.getByTestId("voice-stop").click();
  await expect(page.getByTestId("voice-listening")).toHaveCount(0);
}

/** Types the transcript directly (the phone keyboard's voice typing, or plain typing). */
export async function typeTranscript(page: Page, text: string): Promise<void> {
  await page.getByTestId("voice-transcript").fill(text);
}

export async function parseWithAi(page: Page): Promise<void> {
  await page.getByTestId("voice-parse").click();
  await expect(page.getByTestId("voice-preview")).toBeVisible({ timeout: 15_000 });
}

/** The requests the fake Gemini server received (the key itself is never recorded). */
export async function fakeGeminiRequests(): Promise<Array<{ model: string; keyOk: boolean; keyInUrl: boolean; body: unknown }>> {
  return (await (await fetch(`${FAKE_GEMINI}/__requests`)).json()) as Array<{ model: string; keyOk: boolean; keyInUrl: boolean; body: unknown }>;
}

export async function clearFakeGeminiRequests(): Promise<void> {
  await fetch(`${FAKE_GEMINI}/__requests`, { method: "DELETE" });
}
