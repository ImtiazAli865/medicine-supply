import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { GEMINI_INSTRUCTION } from "../../src/lib/voice/gemini";
import { seedMedicineWithClient, seedStoreWithClient } from "../helpers/pending";
import type { TestTenant } from "../helpers/supabase-test";
import { expect, signIn, test } from "./fixtures";
import { fakeGeminiRequests, installFakeSpeech, openNewOrder, seedVoiceWorld, typeTranscript } from "./voice-helpers";

// User Story 5 of Module 008: only the transcript goes to the AI, and the key never reaches the browser. The fake Gemini
// records the body of every request; the key here is a placeholder sentinel that exists only in the app server's
// environment. Mobile project only.
const SENTINEL = "test-key-sentinel-do-not-use";

function walk(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, found);
    else found.push(full);
  }
  return found;
}

/** Collects the text of every response the page receives (HTML, JSON and scripts). */
function collectResponses(page: Page): string[] {
  const bodies: string[] = [];
  page.on("response", (response) => {
    const type = response.headers()["content-type"] ?? "";
    if (!/json|javascript|html|text/.test(type)) return;
    response
      .text()
      .then((text) => {
        bodies.push(`${response.url()}\n${text}`);
      })
      .catch(() => undefined);
  });
  return bodies;
}

/** Hidden records that exist in the business but are never spoken: none of this may reach the AI. */
async function seedHiddenData(tenant: TestTenant) {
  const hiddenStore = await seedStoreWithClient(tenant.client, "Quokka Hidden Traders");
  await seedMedicineWithClient(tenant.client, {
    name: "Quokkamycin",
    unit: "box",
    purchase_price: "333.33",
    selling_price: "777.77",
    mrp: "888.88",
  });
  const opening = await tenant.client.rpc("ledger_opening_add", {
    p_id: randomUUID(),
    p_store_id: hiddenStore,
    p_amount: "4567.89",
    p_direction: "owes",
    p_as_on: new Date().toISOString().slice(0, 10),
    p_note: null,
  });
  if (opening.error) throw new Error(opening.error.message);
}

const HIDDEN = ["Quokka", "Quokkamycin", "333.33", "777.77", "888.88", "4567.89", "125.50", "310.00", "95.00", "Panadol", "cough syrup"];

test.describe("US5: nothing sensitive leaves the supplier's control", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("the AI request holds only the instruction and the transcript, and the key never appears in a response or the page", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await seedHiddenData(freshTenant);
    await installFakeSpeech(page);
    const bodies = collectResponses(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);

    const token = `Tok${randomUUID().slice(0, 8)}`;
    const sentence = `Al Madina Medical: Brufen 4 box, ${token} 2 box`;
    await typeTranscript(page, sentence);
    await page.getByTestId("voice-parse").click();
    await expect(page.getByTestId("voice-preview")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("voice-line")).toHaveCount(2);
    const preview = await page.locator("body").innerText();

    // the requests of this test (other tests share the fake server, so they are told apart by the unique token)
    const mine = (await fakeGeminiRequests()).filter((r) => JSON.stringify(r.body).includes(token));
    expect(mine).toHaveLength(1);
    const request = mine[0];
    expect(request.keyOk).toBe(true);
    expect(request.keyInUrl).toBe(false);
    const body = request.body as { systemInstruction: { parts: Array<{ text: string }> }; contents: Array<{ role: string; parts: Array<{ text: string }> }>; generationConfig: unknown };
    expect(Object.keys(body).sort()).toEqual(["contents", "generationConfig", "systemInstruction"]);
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].parts).toEqual([{ text: sentence }]);
    expect(body.generationConfig).toEqual({ responseMimeType: "application/json" });
    const sent = JSON.stringify(body);
    for (const secret of HIDDEN) expect(sent, secret).not.toContain(secret);
    // the instruction is the fixed text of the app, with no data of the business
    expect(body.systemInstruction.parts).toEqual([{ text: GEMINI_INSTRUCTION }]);

    // create the draft order; nothing in what the browser saw may carry the key
    await page.getByTestId("voice-create").click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    const orderPage = await page.locator("body").innerText();

    expect(preview).not.toContain(SENTINEL);
    expect(orderPage).not.toContain(SENTINEL);
    expect(bodies.length).toBeGreaterThan(0);
    for (const entry of bodies) expect(entry.includes(SENTINEL), entry.split("\n")[0]).toBe(false);
    for (const entry of bodies) expect(entry, entry.split("\n")[0]).not.toMatch(/generativelanguage\.googleapis\.com/);
    // the preview and the order show no price, balance or cost of any hidden record
    for (const secret of ["333.33", "777.77", "888.88", "4567.89", "Quokka"]) {
      expect(preview, secret).not.toContain(secret);
      expect(orderPage, secret).not.toContain(secret);
    }
  });

  test("a refused key shows the safe message and never the key, and the failure record holds no secret", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    const bodies = collectResponses(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await typeTranscript(page, "Al Madina Medical: Brufen 4 box [[401]]");
    await page.getByTestId("voice-parse").click();
    await expect(page.getByTestId("voice-failure")).toContainText(/not set up on the server/);
    await expect(page.getByTestId("voice-failure")).not.toContainText(/key|token|secret|googleapis/i);
    expect(await page.locator("body").innerText()).not.toContain(SENTINEL);
    for (const entry of bodies) expect(entry.includes(SENTINEL), entry.split("\n")[0]).toBe(false);

    const log = await freshTenant.client.rpc("voice_diag_list", { p_limit: 20, p_offset: 0 });
    expect(log.error).toBeNull();
    const text = JSON.stringify(log.data);
    expect(text).toContain("ai_not_configured");
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain("Brufen");
    expect(text).not.toContain("Al Madina");
  });

  test("the built browser files hold no key, no key header name and no Google address", async () => {
    const staticDir = path.join(process.cwd(), ".next", "static");
    const files = walk(staticDir).filter((f) => /\.(js|css|html|json|map|txt)$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text.includes(SENTINEL), file).toBe(false);
      expect(text, file).not.toMatch(/generativelanguage\.googleapis\.com|x-goog-api-key|GEMINI_API_KEY/);
    }
  });
});
