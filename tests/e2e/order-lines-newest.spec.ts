import { randomUUID } from "node:crypto";
import { addMedicine, seedStore, startOrder, waitSaved } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// The order screen after the owner's trial: a line just added is in view below the search box, newest first, with only the
// latest three open. The saved order keeps the order of adding.
test.describe("the lines of a draft order", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  const NAMES = ["Alpha tablet", "Bravo tablet", "Charlie tablet", "Delta tablet", "Echo tablet"];

  test("shows the newest first, opens three, and never hides a line that needs attention", async ({ page, freshTenant }) => {
    const { error } = await freshTenant.client.from("products").insert(NAMES.map((name) => ({ id: randomUUID(), name, unit: "strip", selling_price: "10.00" })));
    if (error) throw new Error(`seed medicines: ${error.message}`);
    await seedStore(freshTenant, "Al Shifa Pharmacy");
    await signIn(page, freshTenant);
    await startOrder(page, "Al Shifa Pharmacy");

    const rows = page.getByTestId("order-line");
    const open = page.locator('[data-testid="order-line"]:visible');
    const toggle = page.getByTestId("toggle-lines");

    // An invalid quantity on the first line: it must stay open however many lines follow.
    await addMedicine(page, "alpha", NAMES[0]);
    await rows.first().getByLabel("Quantity").fill("0");
    for (const [i, name] of NAMES.entries()) {
      if (i === 0) continue;
      await addMedicine(page, name.split(" ")[0]!.toLowerCase(), name);
      await expect(rows.first()).toContainText(name);
      await expect(rows.first()).toBeInViewport();
    }
    await expect(rows).toHaveCount(5);
    await expect(open).toHaveCount(4);
    await expect(open.last()).toContainText("Alpha tablet");
    await open.last().getByLabel("Quantity").fill("2");
    await expect(open).toHaveCount(3);

    // All lines on request, and back.
    await expect(toggle).toHaveText("Show all 5 lines");
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await expect(open).toHaveCount(5);
    await toggle.click();
    await expect(open).toHaveCount(3);

    // Adding a medicine that is on an older line opens that line.
    await addMedicine(page, "bravo", NAMES[1]);
    await expect(open.filter({ hasText: "Bravo tablet" })).toHaveCount(1);
    await expect(rows).toHaveCount(5);

    // After a reload the newest is still on top, and the first added is still first in the saved order.
    await waitSaved(page);
    await page.reload();
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toContainText("Echo tablet");
    await expect(rows.first()).toHaveAttribute("data-position", "4");
    await expect(rows.last()).toContainText("Alpha tablet");
    await expect(rows.last()).toHaveAttribute("data-position", "0");
    await expect(open).toHaveCount(3);
  });
});
