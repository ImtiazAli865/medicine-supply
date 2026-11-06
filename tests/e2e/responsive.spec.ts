import { expect, signIn, test } from "./fixtures";

// US4 scenario 5: wider screens keep every function available and switch the navigation layout.
test.describe("responsive layout", () => {
  test("navigation moves from the bottom bar to a side bar at desktop width", async ({ page, tenant }) => {
    await signIn(page, tenant);

    await page.setViewportSize({ width: 360, height: 800 });
    const nav = page.getByRole("navigation", { name: "Main" });
    let box = await nav.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeGreaterThan(780); // pinned to the bottom edge

    await page.setViewportSize({ width: 1280, height: 800 });
    box = await nav.boundingBox();
    expect(box!.x).toBeLessThan(5); // left side bar
    expect(box!.height).toBeGreaterThan(300);

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Stores" }).click();
    await expect(page.getByRole("link", { name: "Add store" })).toBeVisible();
    await expect(page.getByLabel("Search stores")).toBeVisible();
  });
});
