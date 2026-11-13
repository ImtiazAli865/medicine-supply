import { randomUUID } from "node:crypto";
import type { TestTenant } from "../helpers/supabase-test";
import { createOrder, line, seedStore, type CreatedOrder } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US4 of Module 004: Pending Prices. A price is typed once, the exact lines are reviewed, and only lines without a
// price are filled. A line that already has a price never changes; every fill is in the order's history.
test.describe("US4: Pending Prices", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  async function newMedicine(tenant: TestTenant, name: string, fields: Record<string, unknown> = {}): Promise<string> {
    const id = randomUUID();
    const { error } = await tenant.client.from("products").insert({ id, name, unit: "strip", ...fields });
    if (error) throw new Error(`seed medicine: ${error.message}`);
    return id;
  }

  const waitingLine = (productId: string, quantity: number) => [{ product_id: productId, quantity, unit: "strip" }];

  /** A medicine with no price on two confirmed orders; one of them was confirmed while the medicine had a price. */
  async function setup(tenant: TestTenant) {
    const alpha = await seedStore(tenant, "Alpha Store");
    const bravo = await seedStore(tenant, "Bravo Store");
    const product = await newMedicine(tenant, "Noran Price", { selling_price: "100.00" });
    const priced = await createOrder(tenant, bravo, waitingLine(product, 5), { confirm: true }); // took 100.00 at confirm
    await tenant.client.from("products").update({ selling_price: null }).eq("id", product);
    const waiting = await createOrder(tenant, alpha, waitingLine(product, 3), { confirm: true }); // no price at confirm
    return { product, alpha, bravo, priced, waiting };
  }

  type Stored = { version: number; lines: Array<{ selling_price: string | null; line_total: string | null; price_basis: string }>; events: Array<{ event_type: string }> };
  const stored = async (tenant: TestTenant, order: CreatedOrder) => (await tenant.client.rpc("order_get", { p_id: order.id })).data as Stored;
  const priceOf = async (tenant: TestTenant, productId: string) => (await tenant.client.from("products").select("selling_price").eq("id", productId).single()).data?.selling_price as number | null;

  test("the list shows a medicine without a price with its waiting lines and orders; Products links to it", async ({ page, freshTenant }) => {
    await setup(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/products");
    await page.getByTestId("pending-prices-link").click();
    await expect(page).toHaveURL(/\/pending\?tab=prices/);
    const item = page.getByTestId("price-item").filter({ hasText: "Noran Price" });
    await expect(item).toBeVisible();
    await expect(item).toContainText("No selling price");
    await expect(item.getByTestId("price-item-waiting")).toHaveText("1 line in 1 order"); // the priced line is not waiting
  });

  test("wrong prices show a message; a good price shows the exact lines, the totals and the lines that stay as they are; confirming fills only those", async ({ page, freshTenant }) => {
    const { product, priced, waiting } = await setup(freshTenant);
    await signIn(page, freshTenant);
    await page.goto(`/pending/prices/${product}`);
    await expect(page.getByRole("heading", { name: "Noran Price" })).toBeVisible();
    await expect(page.getByTestId("price-input")).toHaveValue(""); // never pre-filled

    await page.getByTestId("price-input").fill("0");
    await page.getByTestId("price-review").click();
    await expect(page.getByText("Enter a price greater than zero.")).toBeVisible();
    await page.getByTestId("price-input").fill("12.345");
    await page.getByTestId("price-review").click();
    await expect(page.getByText("Enter an amount like 125 or 125.50 (at most two decimals).")).toBeVisible();
    await page.getByTestId("price-input").fill("");
    await page.getByTestId("price-review").click();
    await expect(page.getByText("Enter the selling price.")).toBeVisible();
    expect(await priceOf(freshTenant, product)).toBeNull(); // nothing was saved

    await page.getByTestId("price-input").fill("125.50");
    await page.getByTestId("price-review").click();
    const panel = page.getByTestId("review-panel");
    await expect(panel).toContainText("These lines will get PKR 125.50");
    await expect(page.getByTestId("fill-line")).toHaveCount(1);
    const row = page.getByTestId("fill-line").first();
    await expect(row).toContainText("Alpha Store");
    await expect(row).toContainText(`ORD-${String(waiting.number).padStart(4, "0")}`);
    await expect(row).toContainText("Qty 3");
    await expect(row).toContainText("PKR 376.50");
    await expect(page.getByTestId("untouched-count")).toContainText(": 1."); // the earlier priced line stays
    expect(await priceOf(freshTenant, product)).toBeNull(); // still nothing saved before the confirm

    await page.getByTestId("fill-confirm").click();
    await expect(page.getByTestId("fill-result")).toContainText("Filled 1 line in 1 order at PKR 125.50.");
    expect(await priceOf(freshTenant, product)).toBe(125.5);

    const after = await stored(freshTenant, waiting);
    expect(after.lines[0]).toMatchObject({ price_basis: "snapshot", selling_price: "125.50", line_total: "376.50" });
    expect(after.events.filter((e) => e.event_type === "price_filled")).toHaveLength(1);
    const earlier = await stored(freshTenant, priced);
    expect(earlier.lines[0]).toMatchObject({ selling_price: "100.00", line_total: "500.00" }); // unchanged
    expect(earlier.version).toBe(priced.version);

    await page.goto(`/orders/${waiting.id}`);
    await expect(line(page, 0).getByTestId("line-price")).toContainText("PKR 125.50");
    await expect(line(page, 0).getByTestId("line-total")).toHaveText("PKR 376.50");
    await expect(page.getByTestId("order-history-log")).toContainText("Price PKR 125.50 recorded for 3");
  });

  test("pressing confirm twice, or refreshing and confirming again, changes nothing more", async ({ page, freshTenant }) => {
    const { product, waiting } = await setup(freshTenant);
    await signIn(page, freshTenant);
    await page.goto(`/pending/prices/${product}`);
    await page.getByTestId("price-input").fill("125.50");
    await page.getByTestId("price-review").click();
    await expect(page.getByTestId("fill-line")).toHaveCount(1);
    await page.getByTestId("fill-confirm").dblclick();
    await expect(page.getByTestId("fill-result")).toBeVisible();
    expect((await stored(freshTenant, waiting)).events.filter((e) => e.event_type === "price_filled")).toHaveLength(1);

    // after a refresh the medicine has its price; nothing is waiting, so there is nothing to fill again
    await page.reload();
    await expect(page.getByTestId("existing-price")).toHaveText("PKR 125.50");
    await expect(page.getByTestId("price-input")).toHaveCount(0);
    await page.getByTestId("fill-at-price").click();
    await expect(page.getByTestId("review-panel")).toContainText("No order line is waiting for a price");
    await expect(page.getByTestId("fill-confirm")).toHaveCount(0);
    const order = await stored(freshTenant, waiting);
    expect(order.events.filter((e) => e.event_type === "price_filled")).toHaveLength(1);
    expect(order.version).toBe(waiting.version + 1);
  });

  test("Save price only sets the medicine's price and leaves the lines waiting; then 'Fill the waiting lines' leads to the same review and fills them", async ({ page, freshTenant }) => {
    const { product, waiting } = await setup(freshTenant);
    await signIn(page, freshTenant);
    await page.goto(`/pending/prices/${product}`);
    await page.getByTestId("price-input").fill("125.50");
    await page.getByTestId("price-review").click();
    await page.getByTestId("save-only").click();
    await expect(page.getByTestId("price-saved")).toContainText("PKR 125.50 is saved");
    expect(await priceOf(freshTenant, product)).toBe(125.5);
    expect((await stored(freshTenant, waiting)).lines[0]).toMatchObject({ price_basis: "none", selling_price: null }); // still waiting
    await expect(page.getByTestId("price-input")).toHaveCount(0); // the price is read-only now
    await expect(page.getByTestId("existing-price")).toHaveText("PKR 125.50");

    await page.getByTestId("fill-at-price").click();
    await expect(page.getByTestId("fill-line")).toHaveCount(1);
    await page.getByTestId("fill-confirm").click();
    await expect(page.getByTestId("fill-result")).toContainText("Filled 1 line in 1 order");
    expect((await stored(freshTenant, waiting)).lines[0]).toMatchObject({ selling_price: "125.50", line_total: "376.50" });
  });

  test("a list that changed in another page shows 'The list changed, review it again' and fills nothing until confirmed again", async ({ page, freshTenant }) => {
    const { product, alpha, waiting } = await setup(freshTenant);
    const third = await createOrder(freshTenant, alpha, waitingLine(product, 4), { confirm: true });
    await signIn(page, freshTenant);
    await page.goto(`/pending/prices/${product}`);
    await page.getByTestId("price-input").fill("20");
    await page.getByTestId("price-review").click();
    await expect(page.getByTestId("fill-line")).toHaveCount(2);

    // the third order is cancelled somewhere else after the review
    const cancel = await freshTenant.client.rpc("order_cancel", { p_id: third.id, p_request_id: randomUUID(), p_expected_version: third.version, p_reason: "test" });
    expect(cancel.error).toBeNull();
    await page.getByTestId("fill-confirm").click();
    await expect(page.getByTestId("list-changed")).toContainText("The list changed, review it again.");
    await expect(page.getByTestId("fill-line")).toHaveCount(1); // the new list
    expect((await stored(freshTenant, waiting)).lines[0]).toMatchObject({ price_basis: "none" }); // nothing was filled
    expect(await priceOf(freshTenant, product)).toBeNull();

    await page.getByTestId("fill-confirm").click();
    await expect(page.getByTestId("fill-result")).toContainText("Filled 1 line in 1 order at PKR 20.00.");
  });

  test("an empty list says 'Nothing needs a price' with a next action", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/pending?tab=prices");
    await expect(page.getByTestId("empty-state")).toContainText("Nothing needs a price");
    await expect(page.getByRole("link", { name: "Add a medicine" })).toBeVisible();
  });

  test("a failed request shows an error with Retry, never the empty state, and recovers", async ({ page, freshTenant }) => {
    await setup(freshTenant);
    await signIn(page, freshTenant);
    let blocked = true;
    await page.route("**/api/pending/prices?*", (route) => (blocked ? route.abort() : route.continue()));
    await page.goto("/pending?tab=prices");
    await expect(page.getByTestId("error-state")).toBeVisible();
    await expect(page.getByTestId("empty-state")).toHaveCount(0);
    blocked = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("price-item").filter({ hasText: "Noran Price" })).toBeVisible();
  });

  test("with the connection failing the fill shows an error and nothing is filled; retrying fills once", async ({ page, freshTenant }) => {
    const { product, waiting } = await setup(freshTenant);
    await signIn(page, freshTenant);
    await page.goto(`/pending/prices/${product}`);
    await page.getByTestId("price-input").fill("125.50");
    await page.getByTestId("price-review").click();
    await expect(page.getByTestId("fill-line")).toHaveCount(1);
    let blocked = true;
    await page.route("**/api/pending/prices/*/apply", (route) => (blocked ? route.abort() : route.continue()));
    await page.getByTestId("fill-confirm").click();
    await expect(page.getByRole("alert").filter({ hasText: "Can't reach the server" })).toBeVisible();
    expect((await stored(freshTenant, waiting)).lines[0]).toMatchObject({ price_basis: "none" });
    blocked = false;
    await page.getByTestId("fill-confirm").click();
    await expect(page.getByTestId("fill-result")).toBeVisible();
    expect((await stored(freshTenant, waiting)).events.filter((e) => e.event_type === "price_filled")).toHaveLength(1);
  });

  test("a priced medicine whose confirmed lines still wait is listed with its price and offers only to fill", async ({ page, freshTenant }) => {
    const alpha = await seedStore(freshTenant, "Alpha Store");
    const product = await newMedicine(freshTenant, "Late Priced");
    const order = await createOrder(freshTenant, alpha, waitingLine(product, 2), { confirm: true });
    await freshTenant.client.from("products").update({ selling_price: "50.00" }).eq("id", product);
    await signIn(page, freshTenant);
    await page.goto("/pending?tab=prices");
    const item = page.getByTestId("price-item").filter({ hasText: "Late Priced" });
    await expect(item).toContainText("PKR 50.00");
    await expect(item.getByTestId("price-item-waiting")).toHaveText("1 line in 1 order");
    await item.click();
    await expect(page.getByTestId("price-input")).toHaveCount(0);
    await page.getByTestId("fill-at-price").click();
    await page.getByTestId("fill-confirm").click();
    await expect(page.getByTestId("fill-result")).toContainText("at PKR 50.00");
    expect((await stored(freshTenant, order)).lines[0]).toMatchObject({ selling_price: "50.00", line_total: "100.00" });
  });
});
