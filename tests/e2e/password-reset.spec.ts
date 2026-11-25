import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { serviceClient, type TestTenant } from "../helpers/supabase-test";
import { expect, signIn, smallTargets, test } from "./fixtures";

// Module 011, US5: a password reset the owner can do alone (mobile, 360 px). The recovery link is made with the service role of the
// TEST project (the same one-time token hash the email carries), so no email is needed and the real verification is exercised.
test.describe("US5: password reset", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(150_000);

  async function recoveryHash(tenant: TestTenant): Promise<string> {
    const { data, error } = await serviceClient().auth.admin.generateLink({ type: "recovery", email: tenant.email });
    if (error || !data.properties?.hashed_token) throw new Error(`generateLink: ${error?.message ?? "no token"}`);
    return data.properties.hashed_token;
  }

  async function check(page: Page, label: string) {
    expect(await smallTargets(page), `small targets on ${label}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `sideways scroll on ${label}`).toBeLessThanOrEqual(0);
  }

  test("the sign-in screen has a Forgot password link that opens the page, and the answer is the same for any address", async ({ page, freshTenant }) => {
    await page.goto("/sign-in");
    await check(page, "the sign-in screen");
    await page.getByTestId("forgot-password-link").click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await check(page, "the forgot password page");
    const neutral = "If this email has an account, a message was sent.";
    // an address that has an account, and one that has none: the same words
    await page.getByLabel("Email").fill(freshTenant.email);
    await page.getByRole("button", { name: "Send the link" }).click();
    await expect(page.getByTestId("forgot-password-message")).toContainText(neutral);
    await page.getByLabel("Email").fill(`nobody-${randomUUID().slice(0, 8)}@example.test`);
    await page.getByRole("button", { name: "Send the link" }).click();
    await expect(page.getByTestId("forgot-password-message")).toContainText(neutral);
    await expect(page.getByTestId("forgot-password-message")).not.toContainText(/not found|no account|unknown|exists/i);
    // nothing typed: a plain message, nothing sent
    await page.getByLabel("Email").fill("");
    await page.getByRole("button", { name: "Send the link" }).click();
    await expect(page.getByTestId("forgot-password-message")).toContainText("Enter your email.");
  });

  test("a good link lets the owner choose a new password and sign in with it; the same link cannot be used again", async ({ page, browser, freshTenant }) => {
    const hash = await recoveryHash(freshTenant);
    await page.goto(`/auth/confirm?token_hash=${encodeURIComponent(hash)}&type=recovery&next=${encodeURIComponent("https://evil.test/steal")}`);
    // the way in is the reset page; the `next` parameter was ignored
    await expect(page).toHaveURL(/\/reset-password$/);
    await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    await expect(page.getByText(/old password/i)).toContainText("You do not need your old password");
    await expect(page.getByLabel(/old password|current password/i)).toHaveCount(0);
    await check(page, "the reset page");

    const fresh = `Pw-${randomUUID()}`;
    await page.locator("#password").fill("short7");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.locator("#password-error")).toHaveText("Use at least 8 characters.");
    await page.locator("#password").fill(fresh);
    await page.locator("#confirm").fill(`${fresh}x`);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("The two passwords do not match.")).toBeVisible();
    await page.locator("#confirm").fill(fresh);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByTestId("reset-done")).toContainText("Your password was changed");
    await expect(page).toHaveURL((url) => url.pathname === "/", { timeout: 15_000 });
    await expect(page.getByTestId("business-name")).toBeVisible();

    // The new password signs in (another browser); the old one no longer does.
    const other = await browser.newContext({ viewport: { width: 360, height: 800 } });
    try {
      const page2 = await other.newPage();
      await page2.goto("/sign-in");
      await page2.getByLabel("Email").fill(freshTenant.email);
      await page2.getByLabel("Password").fill(freshTenant.password);
      await page2.getByRole("button", { name: "Sign in" }).click();
      await expect(page2.getByText("Incorrect email or password.")).toBeVisible();
      await page2.getByLabel("Password").fill(fresh);
      await page2.getByRole("button", { name: "Sign in" }).click();
      await page2.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
      await expect(page2.getByTestId("business-name")).toBeVisible();
    } finally {
      await other.close();
    }

    // The same link, a second time, in a browser with no session
    const third = await browser.newContext({ viewport: { width: 360, height: 800 } });
    try {
      const page3 = await third.newPage();
      await page3.goto(`/auth/confirm?token_hash=${encodeURIComponent(hash)}&type=recovery`);
      await expect(page3).toHaveURL(/\/forgot-password\?error=link$/);
      await expect(page3.getByTestId("reset-link-problem")).toHaveText("This link has expired or was already used. Ask for a new one.");
      await check(page3, "the forgot password page with the link problem");
    } finally {
      await third.close();
    }
  });

  test("a missing, wrong or malformed link goes to the forgot page with the same plain message and no detail", async ({ page }) => {
    const bad = [
      "/auth/confirm",
      "/auth/confirm?type=recovery",
      "/auth/confirm?token_hash=abcdefghijkl",
      "/auth/confirm?token_hash=abcdefghijkl&type=signup",
      "/auth/confirm?token_hash=short&type=recovery",
      "/auth/confirm?token_hash=has%20a%20space&type=recovery",
      `/auth/confirm?token_hash=${"x".repeat(600)}&type=recovery`,
      "/auth/confirm?token_hash=abcdefghijkl&type=recovery&next=https%3A%2F%2Fevil.test",
    ];
    for (const path of bad) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/forgot-password\?error=link$/);
      await expect(page.getByTestId("reset-link-problem"), path).toHaveText("This link has expired or was already used. Ask for a new one.");
    }
  });

  test("the page for a new password without a session sends the visitor to the forgot page", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page).toHaveURL(/\/forgot-password\?error=link$/);
  });

  test("a signed-in owner still reaches every other page as before, and the confirm route is public but holds no data", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/orders");
    await expect(page.getByTestId("business-name")).toBeVisible();
    const response = await page.request.get("/auth/confirm", { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers()["location"]).toMatch(/\/forgot-password\?error=link$/);
    expect(response.headers()["cache-control"]).toContain("no-store");
  });
});
