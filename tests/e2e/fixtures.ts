import { randomUUID } from "node:crypto";
import { expect, test as base, type Page } from "@playwright/test";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// E2E tests drive the real app against the dedicated TEST Supabase project. Without test
// credentials every E2E test is skipped (and reported as skipped), never faked.
export const test = base.extend<{ tenant: TestTenant; freshTenant: TestTenant }, { workerTenant: TestTenant }>({
  workerTenant: [
    async ({}, provide) => {
      if (!hasTestEnv) {
        await provide(undefined as unknown as TestTenant);
        return;
      }
      const tenant = await createTenant("e2e");
      await provide(tenant);
      await deleteTenant(tenant);
    },
    { scope: "worker" },
  ],
  tenant: async ({ workerTenant }, provide) => {
    test.skip(!hasTestEnv, SKIP_REASON);
    await provide(workerTenant);
  },
  // A brand-new business (empty catalog, no stores, default settings) created for ONE test and removed after it.
  freshTenant: async ({}, provide) => {
    test.skip(!hasTestEnv, SKIP_REASON);
    const tenant = await createTenant("e2e-fresh");
    try {
      await provide(tenant);
    } finally {
      await deleteTenant(tenant);
    }
  },
});

export { expect };

export function uniqueName(prefix: string): string {
  return `${prefix} ${randomUUID().slice(0, 6)}`;
}

export async function signIn(page: Page, tenant: Pick<TestTenant, "email" | "password">, next?: string) {
  await page.goto(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
  await page.getByLabel("Email").fill(tenant.email);
  await page.getByLabel("Password").fill(tenant.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
}

/**
 * Every visible interactive element must be at least 44 x 44 CSS pixels. A checkbox or radio inside a
 * <label> is measured by its label row, because tapping anywhere on the label toggles it (the small
 * box itself is not the touch target).
 */
export async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selector = "a[href], button, input:not([type=hidden]), select, textarea, [role=button]";
    const tooSmall: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const isToggle = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio");
      const target = isToggle ? (el.closest("label") ?? el) : el;
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (el.classList.contains("sr-only")) continue;
      if (rect.width < 43.5 || rect.height < 43.5) {
        const label = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? el.tagName;
        tooSmall.push(`${el.tagName} "${label}" ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
    }
    return tooSmall;
  });
}
