import type { Locator, Page } from "@playwright/test";
import type { TestTenant } from "../helpers/supabase-test";
import { expect, signIn, test } from "./fixtures";
import { installFakeSpeech, openNewOrder, parseWithAi, seedVoiceWorld, typeTranscript } from "./voice-helpers";

// User Story 6 of Module 008: the preview is a working screen. Corrections need no AI call, reading the text again asks
// whether to keep the corrections, a 200-line preview says its limit, and Start over leaves no order. The fake Gemini
// answers; nothing here calls a real service. Mobile project only.

/** Counts the requests the page sends to the parse route (every one of them is an AI or simple-reader call). */
function trackParses(page: Page): { count: () => number } {
  let n = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/voice/parse") && request.method() === "POST") n += 1;
  });
  return { count: () => n };
}

const lineFor = (page: Page, name: string): Locator => page.getByTestId("voice-line").filter({ has: page.getByTestId("voice-line-spoken").getByText(name, { exact: true }) });

async function orderCount(tenant: TestTenant): Promise<number> {
  const res = await tenant.client.from("orders").select("id");
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []).length;
}

async function readAgainWith(page: Page, text: string): Promise<void> {
  await page.getByTestId("voice-edit-text").click();
  await page.getByTestId("voice-edit-transcript").fill(text);
  await page.getByTestId("voice-read-again").click();
}

test.describe("US6: correct anything, then read again", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("changes, removals and additions update the preview with no AI call, and the order is created from the corrected preview", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    const parses = trackParses(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await typeTranscript(page, "Al Madina Medical: Brufen 4 box, Panadol 20 strip");
    await parseWithAi(page);
    expect(parses.count()).toBe(1);

    // change a quantity and a unit
    const brufen = lineFor(page, "Brufen");
    await brufen.getByTestId("voice-quantity").fill("7");
    await brufen.getByTestId("voice-unit").fill("boxes");
    await expect(brufen.getByTestId("voice-quantity")).toHaveValue("7");
    // remove a line
    await lineFor(page, "Panadol").getByTestId("voice-remove-line").click();
    await expect(page.getByTestId("voice-line")).toHaveCount(1);

    // add a catalog line by the same medicine search as the manual order screen; its quantity is still to be entered
    await page.getByTestId("voice-add-line").click();
    await page.getByLabel("Search medicines").fill("cough");
    await page.getByTestId("medicine-result").first().click();
    await expect(page.getByTestId("voice-line")).toHaveCount(2);
    await expect(page.getByTestId("voice-create")).toBeDisabled();
    await expect(page.getByTestId("voice-create-reason")).toContainText(/quantity of "cough syrup"/);

    // add a typed line (not in the catalog) with its quantity and unit
    await page.getByTestId("voice-add-line").click();
    await page.getByLabel("Search medicines").fill("Zzyzx Tonic");
    await page.getByTestId("add-as-typed").click();
    await page.locator("#typed-qty").fill("3");
    await page.locator("#typed-unit").fill("bottle");
    await page.getByTestId("add-typed-line").click();
    await expect(page.getByTestId("voice-line")).toHaveCount(3);
    const typed = lineFor(page, "Zzyzx Tonic");
    await expect(typed).toHaveAttribute("data-choice", "typed");
    await expect(typed.getByTestId("voice-quantity")).toHaveValue("3");
    await expect(typed.getByTestId("voice-unit")).toHaveValue("bottle");

    // the draft cannot be created while the quantity is missing; once entered, it can
    await lineFor(page, "cough syrup").getByTestId("voice-quantity").fill("6");
    await expect(page.getByTestId("voice-create")).toBeEnabled();
    expect(parses.count()).toBe(1);
    expect(await orderCount(freshTenant)).toBe(0);

    await page.getByTestId("voice-create").click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("order-line")).toHaveCount(3);
    const orderLines = page.getByTestId("order-line");
    await expect(orderLines.filter({ hasText: "Brufen" })).toHaveCount(1);
    await expect(orderLines.filter({ hasText: "cough syrup" })).toHaveCount(1);
    await expect(orderLines.filter({ hasText: "Panadol" })).toHaveCount(0); // the removed line is not in the order
    // the words that were said stay readable, unchanged, as the order's spoken text
    await expect(page.getByTestId("spoken-text-body")).toHaveText("Al Madina Medical: Brufen 4 box, Panadol 20 strip");
    // the typed line is an editable row on the order screen, so its name and quantity are input values
    const values = await page.locator("input").evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    expect(values).toContain("Zzyzx Tonic");
    expect(values).toContain("6");
    expect(values).toContain("7");
    expect(values).toContain("3");
    expect(await orderCount(freshTenant)).toBe(1);
  });

  test("reading again with corrections asks first: Cancel changes nothing, Keep merges, and the AI is called only after the choice", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    const parses = trackParses(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await typeTranscript(page, "Al Madina Medical: Brufen 4 box, Panadol 20 strip");
    await parseWithAi(page);
    await lineFor(page, "Panadol").getByTestId("voice-quantity").fill("99");
    await lineFor(page, "Brufen").getByTestId("voice-remove-line").click();

    await readAgainWith(page, "Al Madina Medical: Panadol 20 strip, Brufen 4 box, cough syrup 6 bottle");
    await expect(page.getByTestId("keep-corrections-dialog")).toBeVisible();
    expect(parses.count()).toBe(1); // asked first, nothing sent yet

    // Cancel: nothing changes and nothing is sent
    await page.getByTestId("voice-keep-cancel").click();
    await expect(page.getByTestId("keep-corrections-dialog")).toBeHidden();
    expect(parses.count()).toBe(1);
    await expect(lineFor(page, "Panadol").getByTestId("voice-quantity")).toHaveValue("99");

    // Keep: the corrected Panadol stays at 99, the removed Brufen stays removed, the new cough syrup line appears
    await page.getByTestId("voice-read-again").click();
    await page.getByTestId("voice-keep-corrections").click();
    await expect(lineFor(page, "cough syrup")).toBeVisible();
    expect(parses.count()).toBe(2);
    await expect(page.getByTestId("voice-line")).toHaveCount(2);
    await expect(lineFor(page, "Panadol").getByTestId("voice-quantity")).toHaveValue("99");
    await expect(lineFor(page, "Brufen")).toHaveCount(0);
    await expect(page.getByTestId("voice-transcript-readonly")).toContainText("cough syrup 6 bottle");
    expect(await orderCount(freshTenant)).toBe(0);
  });

  test("Discard my corrections replaces everything with the new reading", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    const parses = trackParses(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await typeTranscript(page, "Al Madina Medical: Brufen 4 box, Panadol 20 strip");
    await parseWithAi(page);
    await lineFor(page, "Panadol").getByTestId("voice-quantity").fill("99");
    await lineFor(page, "Brufen").getByTestId("voice-remove-line").click();

    await readAgainWith(page, "Al Madina Medical: Panadol 20 strip, Brufen 4 box");
    await page.getByTestId("voice-discard-corrections").click();
    await expect(page.getByTestId("voice-line")).toHaveCount(2);
    await expect(lineFor(page, "Panadol").getByTestId("voice-quantity")).toHaveValue("20");
    await expect(lineFor(page, "Brufen").getByTestId("voice-quantity")).toHaveValue("4");
    expect(parses.count()).toBe(2);
  });

  test("with no corrections there is no question: the new reading replaces the preview at once", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await typeTranscript(page, "Al Madina Medical: Brufen 4 box");
    await parseWithAi(page);
    await readAgainWith(page, "Al Madina Medical: Panadol 20 strip");
    await expect(lineFor(page, "Panadol")).toBeVisible();
    await expect(page.getByTestId("keep-corrections-dialog")).toBeHidden();
    await expect(page.getByTestId("voice-line")).toHaveCount(1);
    await expect(page.getByTestId("voice-edit-text")).toBeVisible();
  });

  test("a failed new reading shows its message in the editor and leaves the preview and its corrections as they were", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await typeTranscript(page, "Al Madina Medical: Brufen 4 box, Panadol 20 strip");
    await parseWithAi(page);
    await lineFor(page, "Panadol").getByTestId("voice-quantity").fill("55");

    await readAgainWith(page, "Al Madina Medical: Brufen 4 box [[429]]");
    await page.getByTestId("voice-keep-corrections").click();
    await expect(page.getByText(/The voice service is busy/)).toBeVisible();
    await expect(page.getByTestId("voice-line")).toHaveCount(2);
    await expect(lineFor(page, "Panadol").getByTestId("voice-quantity")).toHaveValue("55");
    await expect(page.getByTestId("voice-transcript-readonly")).toHaveCount(0); // still in the editor, text kept
    await expect(page.getByTestId("voice-edit-transcript")).toHaveValue("Al Madina Medical: Brufen 4 box [[429]]");

    // the simple reader finishes the job; the corrections are asked about again
    await page.getByTestId("voice-edit-transcript").fill("Al Madina Medical: Brufen 4 box");
    await page.getByTestId("voice-read-again-rules").click();
    await page.getByTestId("voice-keep-corrections").click();
    await expect(page.getByTestId("voice-transcript-readonly")).toHaveText("Al Madina Medical: Brufen 4 box");
    await expect(lineFor(page, "Panadol").getByTestId("voice-quantity")).toHaveValue("55");
  });

  test("a 200-line preview refuses a further line and says the limit", async ({ page, freshTenant }) => {
    test.setTimeout(150_000);
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    const items = Array.from({ length: 200 }, (_, i) => `A${i + 1} 1 b`).join(", ");
    await typeTranscript(page, `Al Madina Medical: ${items}`);
    await page.getByTestId("voice-parse").click();
    await expect(page.getByTestId("voice-preview")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("voice-line")).toHaveCount(200);
    await expect(page.getByTestId("voice-add-line")).toBeDisabled();
    await expect(page.getByTestId("voice-line-limit")).toContainText("at most 200 lines");
    // removing one line makes room for one more
    await page.getByTestId("voice-line").first().getByTestId("voice-remove-line").click();
    await expect(page.getByTestId("voice-line")).toHaveCount(199);
    await expect(page.getByTestId("voice-add-line")).toBeEnabled();
    await expect(page.getByTestId("voice-line-limit")).toHaveCount(0);
  });

  test("Start over asks first, can be declined, and when confirmed clears the text and the preview and creates no order", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await typeTranscript(page, "Al Madina Medical: Brufen 4 box");
    await parseWithAi(page);

    await page.getByTestId("voice-start-over").click();
    await expect(page.getByRole("dialog", { name: "Start over?" })).toBeVisible();
    await page.getByRole("button", { name: "Keep working" }).click();
    await expect(page.getByTestId("voice-preview")).toBeVisible();

    await page.getByTestId("voice-start-over").click();
    await page.getByTestId("voice-start-over-confirm").click();
    await expect(page.getByTestId("voice-preview")).toHaveCount(0);
    await expect(page.getByTestId("voice-transcript")).toHaveValue("");
    await expect(page.getByTestId("store-option").first()).toBeVisible();
    expect(await page.evaluate(() => window.sessionStorage.getItem("voice-preview-v1"))).toBeNull();
    // a reload finds nothing to restore
    await page.reload();
    await expect(page.getByTestId("voice-panel")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("voice-transcript")).toHaveValue("");
    expect(await orderCount(freshTenant)).toBe(0);
  });

  test("a medicine deactivated after the preview is refused with its line named, nothing is created, and removing the line lets the order through", async ({ page, freshTenant }) => {
    const world = await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    await typeTranscript(page, "Al Madina Medical: Brufen 4 box, Panadol 20 strip");
    await parseWithAi(page);
    await expect(page.getByTestId("voice-create")).toBeEnabled();

    // the medicine is deactivated in another place after the preview was made
    const off = await freshTenant.client.from("products").update({ is_active: false }).eq("id", world.brufen);
    expect(off.error).toBeNull();

    await page.getByTestId("voice-create").click();
    await expect(page.getByText(/no longer available in your catalog/)).toBeVisible();
    await expect(page.getByText(/no longer available in your catalog/)).toContainText('"Brufen"');
    await expect(page.getByText(/no longer available in your catalog/)).toContainText("Nothing was created");
    await expect(page.getByTestId("voice-preview")).toBeVisible();
    await expect(page.getByTestId("voice-line")).toHaveCount(2);
    expect(await orderCount(freshTenant)).toBe(0);

    // the supplier fixes it by removing that line, and the same screen creates the order
    await lineFor(page, "Brufen").getByTestId("voice-remove-line").click();
    await page.getByTestId("voice-create").click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    expect(await orderCount(freshTenant)).toBe(1);
  });
});
