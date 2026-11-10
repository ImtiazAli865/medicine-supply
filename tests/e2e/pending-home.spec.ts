import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { TestTenant } from "../helpers/supabase-test";
import { createOrder, seedStore } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US5 of Module 004: pending items stay visible. Home and the Pending screen show what needs attention, and the
// numbers always match the lists they link to.
test.describe("US5: pending items stay visible", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  async function newMedicine(tenant: TestTenant, name: string): Promise<string> {
    const id = randomUUID();
    const { error } = await tenant.client.from("products").insert({ id, name, unit: "strip" });
    if (error) throw new Error(`seed medicine: ${error.message}`);
    return id;
  }

  /**
   * Two typed groups ("Noran 20mg" in two stores, "Zed" once) and one unpriced medicine on a confirmed order.
   * Typed groups: 2. Medicines needing a price: 1 (with a waiting line).
   */
  async function setup(tenant: TestTenant) {
    const alpha = await seedStore(tenant, "Alpha Store");
    const bravo = await seedStore(tenant, "Bravo Store");
    const bare = await newMedicine(tenant, "Cal Bare");
    const first = await createOrder(
      tenant,
      alpha,
      [{ product_id: null, name: "Noran 20mg", quantity: 3, unit: "strip" }, { product_id: null, name: "Zed", quantity: 1, unit: "box" }, { product_id: bare, quantity: 2, unit: "strip" }],
      { confirm: true },
    );
    const second = await createOrder(tenant, bravo, [{ product_id: null, name: "noran 20mg", quantity: 4, unit: "box" }]); // a draft
    return { first, second };
  }

  async function registerFirstLineOf(page: Page, groupText: string) {
    const group = page.getByTestId("typed-group").filter({ has: page.getByRole("heading", { name: groupText, exact: true }) });
    await group.getByTestId("register-medicine").first().click();
    await page.getByRole("dialog").getByTestId("register-submit").click();
  }

  test("Home shows what needs attention with counts that match the lists, and links to them", async ({ page, freshTenant }) => {
    await setup(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/");
    await expect(page.getByTestId("pending-summary")).toContainText("Needs attention");
    await expect(page.getByTestId("pending-typed-count")).toHaveText("2 typed medicines to register");
    await expect(page.getByTestId("pending-price-count")).toHaveText("1 medicine needs a price (1 has orders waiting)");

    await page.getByTestId("pending-typed-link").click();
    await expect(page).toHaveURL(/\/pending\?tab=register/);
    await expect(page.getByTestId("typed-group")).toHaveCount(2); // the same number as on Home
    await expect(page.getByTestId("pending-tab-register")).toHaveText("To register (2)");
    await expect(page.getByTestId("pending-tab-register")).toHaveAttribute("aria-current", "page");

    await page.goto("/");
    await page.getByTestId("pending-price-link").click();
    await expect(page).toHaveURL(/\/pending\?tab=prices/);
    await expect(page.getByTestId("price-item")).toHaveCount(1);
    await expect(page.getByTestId("pending-tab-prices")).toHaveText("Need a price (1)");
  });

  test("the To register tab groups the same text from two stores and offers both actions on each line", async ({ page, freshTenant }) => {
    const { first, second } = await setup(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/pending?tab=register");
    const group = page.getByTestId("typed-group").filter({ has: page.getByRole("heading", { name: "Noran 20mg", exact: true }) });
    await expect(group.getByTestId("typed-group-count")).toHaveText("2 lines");
    const lines = group.getByTestId("typed-line");
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toContainText("Alpha Store");
    await expect(lines.nth(0)).toContainText(`ORD-${String(first.number).padStart(4, "0")}`);
    await expect(lines.nth(0).getByTestId("typed-line-qty")).toContainText("3 strip");
    await expect(lines.nth(0)).toContainText("Confirmed");
    await expect(lines.nth(1)).toContainText("Bravo Store");
    await expect(lines.nth(1)).toContainText(`ORD-${String(second.number).padStart(4, "0")}`);
    await expect(lines.nth(1).getByTestId("typed-line-qty")).toContainText("4 box");
    await expect(lines.nth(1)).toContainText("Draft");
    for (const i of [0, 1]) {
      await expect(lines.nth(i).getByTestId("register-medicine")).toBeVisible();
      await expect(lines.nth(i).getByTestId("link-existing-medicine")).toBeVisible();
    }
    await page.getByLabel("Search typed medicines").fill("zed");
    await expect(page.getByTestId("typed-group")).toHaveCount(1);
  });

  test("after registering and pricing everything, Home says nothing needs attention", async ({ page, freshTenant }) => {
    await setup(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/pending?tab=register");

    // "Noran 20mg": register one line; the other (the same text) is proposed and linked
    await registerFirstLineOf(page, "Noran 20mg");
    const proposals = page.getByRole("dialog");
    await expect(proposals.getByTestId("proposal-line")).toHaveCount(1);
    await proposals.getByTestId("proposal-confirm").click();
    await expect(proposals.getByTestId("proposal-linked")).toBeVisible();
    await proposals.getByTestId("proposals-close").click();
    await expect(page.getByTestId("typed-group")).toHaveCount(1); // the list refreshed: only "Zed" is left
    await registerFirstLineOf(page, "Zed");
    await expect(page.getByTestId("empty-state")).toContainText("Nothing to register");
    await expect(page.getByRole("link", { name: "Take an order" })).toBeVisible();

    // three medicines now need a price (Cal Bare, Noran 20mg, Zed): price each
    await page.goto("/pending?tab=prices");
    await expect(page.getByTestId("price-item")).toHaveCount(3);
    for (let n = 3; n > 0; n -= 1) {
      await page.getByTestId("price-item").first().click();
      await page.getByTestId("price-input").fill("10");
      await page.getByTestId("price-review").click();
      // every one of the three has a confirmed line waiting, so the review offers to fill it
      await page.getByTestId("fill-confirm").click();
      await expect(page.getByTestId("fill-result")).toBeVisible();
      await page.goto("/pending?tab=prices");
      await expect(page.getByTestId("price-item")).toHaveCount(n - 1);
    }
    await expect(page.getByTestId("empty-state")).toContainText("Nothing needs a price");

    await page.goto("/");
    await expect(page.getByTestId("pending-summary-clear")).toHaveText("Nothing needs attention.");
    await expect(page.getByTestId("pending-typed-count")).toHaveCount(0);
    await expect(page.getByTestId("pending-price-count")).toHaveCount(0);
  });

  test("a failing summary request shows an error with Retry on the card, never 'nothing needs attention', and recovers", async ({ page, freshTenant }) => {
    await setup(freshTenant);
    await signIn(page, freshTenant);
    let blocked = true;
    await page.route("**/api/pending/summary", (route) => (blocked ? route.abort() : route.continue()));
    await page.goto("/");
    await expect(page.getByTestId("pending-summary-error")).toContainText("Can't reach the server");
    await expect(page.getByTestId("pending-summary-clear")).toHaveCount(0);
    blocked = false;
    await page.getByTestId("pending-summary-error").getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("pending-typed-count")).toHaveText("2 typed medicines to register");
  });

  test("with nothing pending both tabs and Home show empty states that name the next action, and the first tab is Need a price", async ({ page, freshTenant }) => {
    await signIn(page, freshTenant);
    await page.goto("/");
    await expect(page.getByTestId("pending-summary-clear")).toBeVisible();
    await page.goto("/pending");
    await expect(page.getByTestId("pending-tab-prices")).toHaveAttribute("aria-current", "page"); // no typed lines: start on prices
    await expect(page.getByTestId("empty-state")).toContainText("Nothing needs a price");
    await expect(page.getByRole("link", { name: "Add a medicine" })).toBeVisible();
    await page.getByTestId("pending-tab-register").click();
    await expect(page.getByTestId("empty-state")).toContainText("Nothing to register");
    await expect(page.getByRole("link", { name: "Take an order" })).toBeVisible();
  });

  test("with typed lines the Pending screen starts on To register", async ({ page, freshTenant }) => {
    await setup(freshTenant);
    await signIn(page, freshTenant);
    await page.goto("/pending");
    await expect(page.getByTestId("pending-tab-register")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("typed-group")).toHaveCount(2);
  });

  test("an order with a typed line links to the Pending screen, and Products links to Pending Prices", async ({ page, freshTenant }) => {
    const { first } = await setup(freshTenant);
    await signIn(page, freshTenant);
    await page.goto(`/orders/${first.id}`);
    await page.getByTestId("pending-link").click();
    await expect(page).toHaveURL(/\/pending\?tab=register/);
    await page.goto("/products");
    await expect(page.getByTestId("pending-prices-link")).toBeVisible();
  });

  test("a failed typed list shows an error with Retry, never the empty state, and recovers", async ({ page, freshTenant }) => {
    await setup(freshTenant);
    await signIn(page, freshTenant);
    let blocked = true;
    await page.route("**/api/pending/typed?*", (route) => (blocked ? route.abort() : route.continue()));
    await page.goto("/pending?tab=register");
    await expect(page.getByTestId("error-state")).toBeVisible();
    await expect(page.getByTestId("empty-state")).toHaveCount(0);
    blocked = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("typed-group")).toHaveCount(2);
  });

  test("the summary and typed endpoints answer 401 without a session", async ({ request }) => {
    for (const url of ["/api/pending/summary", "/api/pending/typed", "/api/pending/prices", "/api/pending/candidates?product_id=" + randomUUID()]) {
      const response = await request.get(url);
      expect(response.status(), url).toBe(401);
    }
  });
});
