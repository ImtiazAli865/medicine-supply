import { randomUUID } from "node:crypto";
import type { TestTenant } from "../helpers/supabase-test";
import { createTenant, deleteTenant } from "../helpers/supabase-test";
import { expect, signIn, smallTargets, test } from "./fixtures";
import { installFakeSpeech, openNewOrder, seedVoiceWorld, typeTranscript } from "./voice-helpers";

// User Story 5 of Module 008: the owner can read the voice diagnostic log. It is read only, newest first, shows counts and
// the length of the text, and never what was said. Mobile project only.
async function addRecord(tenant: TestTenant, kind: string, extra: { items?: number; doubtful?: number; unreadable?: number; length?: number; message?: string | null } = {}) {
  const res = await tenant.client.rpc("voice_diag_add", {
    p_kind: kind,
    p_parser: "ai",
    p_items: extra.items ?? 0,
    p_doubtful: extra.doubtful ?? 0,
    p_unreadable: extra.unreadable ?? 0,
    p_transcript_length: extra.length ?? 0,
    p_message: extra.message ?? null,
  });
  if (res.error) throw new Error(res.error.message);
}

test.describe("US5: the voice diagnostics screen", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("Settings has a Voice diagnostics link that opens the screen", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/settings");
    await page.getByTestId("voice-diagnostics-link").click();
    await page.waitForURL(/\/settings\/voice-diagnostics$/);
    await expect(page.getByRole("heading", { name: "Voice diagnostics" })).toBeVisible();
    expect(await smallTargets(page)).toEqual([]);
  });

  test("an empty business sees the empty state with the next step, never an error", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/settings/voice-diagnostics");
    await expect(page.getByTestId("empty-state")).toContainText(/No voice problems recorded/);
    await expect(page.getByRole("link", { name: "Take an order" })).toBeVisible();
    await expect(page.getByTestId("error-state")).toHaveCount(0);
    expect(await smallTargets(page)).toEqual([]);
  });

  test("records show newest first with kind, time and counts, and no control to export, edit or delete", async ({ page, freshTenant }) => {
    await addRecord(freshTenant, "ai_busy", { items: 2, doubtful: 1, unreadable: 0, length: 42, message: "The voice service answered that it is busy (rate limit)." });
    await addRecord(freshTenant, "ai_timeout", { items: 0, length: 17, message: "The voice service did not answer in time." });
    await addRecord(freshTenant, "low_confidence", { items: 5, doubtful: 3, unreadable: 1, length: 120, message: null });
    await signIn(page, freshTenant);
    await page.goto("/settings/voice-diagnostics");

    const rows = page.getByTestId("voice-diagnostic");
    await expect(rows).toHaveCount(3);
    expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-kind")))).toEqual(["low_confidence", "ai_timeout", "ai_busy"]);
    const first = rows.first();
    await expect(first.getByTestId("voice-diagnostic-kind")).toHaveText("Needed a closer look");
    await expect(first.getByTestId("voice-diagnostic-time")).toHaveText(/\d{4}|\d{1,2}:\d{2}/);
    await expect(first).toContainText("Items 5, doubtful 3, unreadable 1");
    await expect(first).toContainText("Text length 120 characters");
    await expect(rows.nth(2)).toContainText("Voice service busy");
    await expect(rows.nth(2)).toContainText("The voice service answered that it is busy (rate limit).");

    await expect(page.getByRole("button", { name: /export|delete|edit|clear|remove/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /export|download/i })).toHaveCount(0);
    expect(await smallTargets(page)).toEqual([]);
  });

  test("a failed parse writes a record that shows the kind and the length of the text, never the words", async ({ page, freshTenant }) => {
    await seedVoiceWorld(freshTenant);
    await installFakeSpeech(page);
    await signIn(page, freshTenant);
    await openNewOrder(page);
    const token = `Secret${randomUUID().slice(0, 8)}`;
    const sentence = `Al Madina Medical: ${token} 4 box [[500]]`;
    await typeTranscript(page, sentence);
    await page.getByTestId("voice-parse").click();
    await expect(page.getByTestId("voice-failure")).toContainText(/could not be reached/);

    await page.goto("/settings/voice-diagnostics");
    const row = page.getByTestId("voice-diagnostic").first();
    await expect(row).toHaveAttribute("data-kind", "ai_unavailable");
    await expect(row).toContainText(`Text length ${sentence.length} characters`);
    const text = await page.locator("body").innerText();
    expect(text).not.toContain(token);
    expect(text).not.toContain("Al Madina");
    expect(text).not.toContain("test-key-sentinel-do-not-use");
  });

  test("a failing request shows an error with Retry and never the empty state, and Retry recovers", async ({ page, freshTenant }) => {
    await addRecord(freshTenant, "ai_invalid", { items: 1, length: 9, message: "The voice service answer was blocked, unfinished or did not fit the expected shape." });
    await signIn(page, freshTenant);
    let fail = true;
    await page.route("**/api/voice/diagnostics*", (route) => (fail ? route.abort("failed") : route.continue()));
    await page.goto("/settings/voice-diagnostics");
    await expect(page.getByTestId("error-state")).toBeVisible();
    await expect(page.getByTestId("empty-state")).toHaveCount(0);
    fail = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("voice-diagnostic")).toHaveCount(1);
    await expect(page.getByTestId("error-state")).toHaveCount(0);
  });

  test("a second business sees none of the first business's records", async ({ page, freshTenant }) => {
    await addRecord(freshTenant, "ai_busy", { length: 11, message: "First business only." });
    const other = await createTenant("e2e-voice-other");
    try {
      await addRecord(other, "ai_timeout", { length: 22, message: "Second business only." });
      await signIn(page, other);
      await page.goto("/settings/voice-diagnostics");
      const rows = page.getByTestId("voice-diagnostic");
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText("Second business only.");
      await expect(page.locator("body")).not.toContainText("First business only.");
    } finally {
      await deleteTenant(other);
    }
  });

  test("more than one page of records can be shown with Show more", async ({ page, freshTenant }) => {
    test.setTimeout(120_000);
    for (let i = 0; i < 22; i += 1) await addRecord(freshTenant, "low_confidence", { items: i, length: i + 1 });
    await signIn(page, freshTenant);
    await page.goto("/settings/voice-diagnostics");
    await expect(page.getByTestId("voice-diagnostic")).toHaveCount(20);
    await page.getByTestId("voice-diagnostics-more").click();
    await expect(page.getByTestId("voice-diagnostic")).toHaveCount(22);
    await expect(page.getByTestId("voice-diagnostics-more")).toHaveCount(0);
  });
});
