import { randomUUID } from "node:crypto";
import { expect, signIn, smallTargets, test } from "./fixtures";

// SC-007: at 360 px every interactive control is at least 44 x 44 px, and nothing overflows sideways.
// Every screen is measured only after its data and content have loaded; measuring earlier can miss
// controls that appear later (the setup checklist and the settings form load their data first).
test.describe("touch targets and layout at 360 px", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("sign-in screen", async ({ page, tenant }) => {
    void tenant;
    await page.goto("/sign-in");
    await page.waitForLoadState("networkidle");
    expect(await smallTargets(page)).toEqual([]);
  });

  test("every signed-in screen", async ({ page, tenant }) => {
    await signIn(page, tenant);
    for (const path of ["/", "/products", "/products/new", "/products/import", "/stores", "/stores/new", "/settings"]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      if (path === "/settings") {
        await expect(page.getByLabel("Business name")).toBeVisible();
        await expect(page.locator("#summary")).toBeVisible();
      }
      expect(await smallTargets(page), `small targets on ${path}`).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
    }
  });

  test("home with completed setup items shows 'Open' links that are large enough", async ({ page, freshTenant }) => {
    // A store and a medicine make two checklist items "done", which shows their "Open" links.
    const store = await freshTenant.client.from("stores").insert({ id: randomUUID(), name: "Touch Target Store" });
    expect(store.error).toBeNull();
    const product = await freshTenant.client.from("products").insert({ id: randomUUID(), name: "Touch Target Medicine", unit: "strip" });
    expect(product.error).toBeNull();

    await signIn(page, freshTenant);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("link", { name: "Open", exact: true }).first()).toBeVisible();
    expect(await smallTargets(page), "small targets on / with done checklist items").toEqual([]);
  });
});
