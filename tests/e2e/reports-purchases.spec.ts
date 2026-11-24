import { randomUUID } from "node:crypto";
import { recordArgs, recordBody, voidArgs } from "../helpers/market";
import { expect, signIn, test } from "./fixtures";
import { seedInvoiceWorld } from "./invoice-helpers";
import { todayInPakistan } from "./market-helpers";

// US2 of Module 010: the purchase summary counts actual quantity times actual cost, leaves out cancelled entries and names
// entries without a cost.
test.describe("US2: purchases", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("counts costed entries, names the entry without a cost, and leaves out a cancelled entry", async ({ page, freshTenant }) => {
    const seed = await seedInvoiceWorld(freshTenant);
    const today = todayInPakistan();
    const costed = await freshTenant.client.rpc("purchase_record", recordArgs(recordBody(seed.pricedId, today, 10, { unit_cost: "80.00" })));
    expect(costed.data).toMatchObject({ done: true });
    const uncosted = await freshTenant.client.rpc("purchase_record", recordArgs(recordBody(seed.sellingOnlyId, today, 4, { unit: "box" })));
    expect(uncosted.data).toMatchObject({ done: true });
    const cancelled = await freshTenant.client.rpc("purchase_record", recordArgs(recordBody(seed.pricedId, today, 3, { unit_cost: "70.00", id: randomUUID() })));
    expect(cancelled.data).toMatchObject({ done: true });
    const voided = await freshTenant.client.rpc("purchase_void", voidArgs(cancelled.data.entry.id, "Wrong entry"));
    expect(voided.data).toMatchObject({ done: true });

    await signIn(page, freshTenant);
    await page.goto("/reports/purchases");
    await expect(page.getByTestId("report-total-cost")).toHaveText("PKR 800.00");
    await expect(page.getByTestId("report-total-entries")).toContainText("2 purchase entries");
    await expect(page.getByTestId("report-status")).toHaveAttribute("data-status", "incomplete");
    await expect(page.getByTestId("report-missing")).toContainText("1 purchase entry has no cost recorded (4 units)");
    await expect(page.getByTestId("report-excluded")).toContainText("1 cancelled purchase entry is left out.");
    for (const group of ["Week", "Month"]) {
      await page.getByTestId("report-group").getByRole("button", { name: group, exact: true }).click();
      await expect(page.getByTestId("report-total-cost")).toHaveText("PKR 800.00");
    }
  });

  test("an empty period points to the market list", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/reports/purchases");
    await expect(page.getByTestId("report-empty")).toContainText("A tick alone is never counted as a purchase");
    await page.getByTestId("report-empty").getByRole("link", { name: "Open the market list" }).click();
    await expect(page).toHaveURL(/\/market-list/);
  });
});
