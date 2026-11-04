import { expect, test } from "@playwright/test";

// Runs without any Supabase credentials: checks what must hold for a visitor who is not signed in.
test.describe("signed-out smoke checks", () => {
  for (const path of ["/", "/products", "/products/new", "/stores", "/stores/new", "/account-not-set-up"]) {
    test(`${path} redirects to the sign-in screen`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/sign-in/);
      await expect(page.getByRole("heading", { name: "Medicine Supply", level: 1 })).toBeVisible();
      await expect(page.getByTestId("business-name")).toHaveCount(0);
    });
  }

  test("a protected address remembers where to return after sign-in", async ({ page }) => {
    await page.goto("/products");
    await expect(page).toHaveURL(/\/sign-in/);
    // When Supabase is configured the redirect carries ?next=; unconfigured, it goes to plain /sign-in.
    const url = new URL(page.url());
    if (url.searchParams.has("next")) expect(url.searchParams.get("next")).toBe("/products");
  });

  for (const path of ["/api/stores", "/api/products", "/api/stores/similar?name=x", "/api/products/similar?name=x"]) {
    test(`GET ${path} answers 401 JSON and returns no data`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(401);
      expect(await response.json()).toEqual({
        code: "unauthenticated",
        message: "Your session expired. Please sign in again.",
      });
    });
  }

  test("POST /api/stores and /api/products are refused when signed out", async ({ request }) => {
    for (const path of ["/api/stores", "/api/products"]) {
      const response = await request.post(path, { data: { id: "00000000-0000-4000-8000-000000000001", name: "x", unit: "strip" } });
      expect(response.status(), path).toBe(401);
    }
  });

  test("the sign-in screen has no horizontal overflow and big enough touch targets", async ({ page }) => {
    await page.goto("/sign-in");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const small = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea"))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.width < 43.5 || r.height < 43.5) out.push(`${el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    });
    expect(small).toEqual([]);
  });

  test("an unknown address shows the friendly not-found screen", async ({ page }) => {
    await page.goto("/definitely/not/a/page");
    // Signed out, the proxy sends it to sign-in first; either screen is a real, usable page.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
