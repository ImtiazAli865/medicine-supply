import { createOrder, line, seedMedicines, seedStore } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US1 of Module 004: register a typed medicine from the order line. Nothing is lost, nothing is invented.
test.describe("US1: register a typed medicine from the order line", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  async function setup(freshTenant: Parameters<typeof seedStore>[0], options: { confirm?: boolean; typed?: string } = {}) {
    const catalog = await seedMedicines(freshTenant);
    const store = await seedStore(freshTenant);
    const order = await createOrder(
      freshTenant,
      store,
      [
        { product_id: null, name: options.typed ?? "Noran 20mg cap", quantity: 3, unit: "strip" },
        { product_id: catalog.sellingOnlyId, quantity: 2, unit: "box" },
      ],
      { confirm: options.confirm ?? true },
    );
    return { catalog, store, order };
  }

  test("registers with only a name and unit: the line is linked, the typed text and quantity stay, nothing else changes", async ({ page, freshTenant }) => {
    const { order } = await setup(freshTenant);
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    const typed = line(page, 0);
    await expect(typed).toContainText("Not registered");
    await typed.getByTestId("register-medicine").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(/^Medicine name/)).toHaveValue("Noran 20mg cap");
    await expect(dialog.getByLabel(/^Unit/)).toHaveValue("strip");
    await dialog.getByTestId("register-more").click();
    for (const label of ["Strength", "Dosage form", "Pack size", "Manufacturer", "SKU (code)", "Brand", "Generic name", "Selling price (PKR)", "Purchase price (PKR)", "MRP (PKR)"]) {
      await expect(dialog.getByLabel(label, { exact: true }), label).toHaveValue("");
    }
    await dialog.getByTestId("register-submit").click();
    await expect(dialog).toBeHidden();

    await expect(typed.getByTestId("line-typed-name")).toHaveText("As typed: Noran 20mg cap");
    await expect(typed).not.toContainText("Not registered");
    await expect(typed.getByTestId("line-qty-unit")).toContainText("3");
    await expect(typed.getByTestId("line-qty-unit")).toContainText("strip");
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await expect(line(page, 1)).toContainText("Brufen 400mg");
    await expect(page.getByTestId("order-history-log")).toContainText("Medicine linked");

    const made = await freshTenant.client.from("products").select("id, strength, selling_price, purchase_price, mrp").eq("name", "Noran 20mg cap");
    expect(made.data).toHaveLength(1);
    expect(made.data![0]).toMatchObject({ strength: null, selling_price: null, purchase_price: null, mrp: null });

    // the new medicine is in the catalog and found by the normal search
    await page.goto("/products");
    await page.getByRole("searchbox").fill("noran");
    await expect(page.getByRole("link", { name: /Noran 20mg cap/ })).toBeVisible();
  });

  test("an exact duplicate is not created again: the existing medicine is shown", async ({ page, freshTenant }) => {
    const { order } = await setup(freshTenant, { typed: "brufen typed" });
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    await line(page, 0).getByTestId("register-medicine").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/^Medicine name/).fill("  brufen   400MG ");
    await dialog.getByTestId("register-more").click();
    await dialog.getByLabel("Strength", { exact: true }).fill("400 mg");
    await dialog.getByLabel("Dosage form", { exact: true }).fill("TABLET");
    await dialog.getByTestId("register-submit").click();

    await expect(dialog.getByTestId("register-duplicate")).toBeVisible();
    await expect(dialog.getByTestId("conflict-match")).toContainText("Brufen 400mg");
    await expect(dialog.getByTestId("create-separate-medicine")).toHaveCount(0);
    const count = await freshTenant.client.from("products").select("id").ilike("name", "%brufen%");
    expect(count.data).toHaveLength(1);

    await dialog.getByRole("button", { name: "Go back" }).click();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(line(page, 0)).toContainText("Not registered");
  });

  test("the same name with a different strength needs 'Create as a separate medicine' and is never merged", async ({ page, freshTenant }) => {
    const { order } = await setup(freshTenant, { typed: "panadol 250" });
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    await line(page, 0).getByTestId("register-medicine").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/^Medicine name/).fill("Panadol 500mg");
    await dialog.getByTestId("register-more").click();
    await dialog.getByLabel("Strength", { exact: true }).fill("250 mg");
    await dialog.getByLabel("Dosage form", { exact: true }).fill("tablet");
    await dialog.getByTestId("register-submit").click();

    await expect(dialog.getByTestId("register-similar")).toBeVisible();
    await expect(dialog.getByTestId("conflict-match")).toContainText("Panadol 500mg");
    const before = await freshTenant.client.from("products").select("id").ilike("name", "Panadol%");
    expect(before.data).toHaveLength(1);

    await dialog.getByTestId("create-separate-medicine").click();
    await expect(dialog).toBeHidden();
    await expect(line(page, 0).getByTestId("line-typed-name")).toHaveText("As typed: panadol 250");
    const after = await freshTenant.client.from("products").select("strength").ilike("name", "Panadol%").order("strength");
    expect(after.data).toEqual([{ strength: "250 mg" }, { strength: "500 mg" }]);
  });

  test("an empty name or unit shows a message on that field and creates nothing", async ({ page, freshTenant }) => {
    const { order } = await setup(freshTenant);
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    await line(page, 0).getByTestId("register-medicine").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/^Medicine name/).fill("   ");
    await dialog.getByLabel(/^Unit/).fill("");
    await dialog.getByTestId("register-submit").click();
    await expect(dialog.getByText("Enter the medicine name.")).toBeVisible();
    await expect(dialog.getByText("Choose or enter a unit.")).toBeVisible();
    const rows = await freshTenant.client.from("products").select("id").ilike("name", "Noran%");
    expect(rows.data).toEqual([]);
  });

  test("on a confirmed order a typed selling price asks 'Use PKR X for this line?': Yes records it on the line and in the history", async ({ page, freshTenant }) => {
    const { order } = await setup(freshTenant);
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    await line(page, 0).getByTestId("register-medicine").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("register-more").click();
    await dialog.getByLabel("Selling price (PKR)", { exact: true }).fill("125.50");
    await dialog.getByTestId("register-submit").click();
    await expect(dialog.getByTestId("register-price-step")).toContainText("PKR 125.50");
    await dialog.getByTestId("register-price-yes").click();
    await expect(dialog).toBeHidden();

    await expect(line(page, 0).getByTestId("line-price")).toContainText("PKR 125.50");
    await expect(line(page, 0).getByTestId("line-total")).toHaveText("PKR 376.50");
    await expect(page.getByTestId("order-history-log")).toContainText("price PKR 125.50 recorded");
  });

  test("answering No leaves the line without a price", async ({ page, freshTenant }) => {
    const { order } = await setup(freshTenant);
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    await line(page, 0).getByTestId("register-medicine").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("register-more").click();
    await dialog.getByLabel("Selling price (PKR)", { exact: true }).fill("125.50");
    await dialog.getByTestId("register-submit").click();
    await dialog.getByTestId("register-price-no").click();
    await expect(dialog).toBeHidden();

    await expect(line(page, 0)).toContainText("No selling price");
    await expect(line(page, 0).getByTestId("line-price")).toHaveCount(0);
    await expect(page.getByTestId("order-history-log")).toContainText("no price recorded");
    const made = await freshTenant.client.from("products").select("selling_price").eq("name", "Noran 20mg cap");
    expect(made.data).toEqual([{ selling_price: 125.5 }]); // the medicine has its price; the line does not
  });

  test("a draft open in a second page is told it changed elsewhere and keeps its typed data", async ({ page, context, freshTenant }) => {
    const { order } = await setup(freshTenant, { confirm: false });
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    await expect(line(page, 0).getByLabel("Quantity")).toHaveValue("3");
    const other = await context.newPage();
    await other.goto(`/orders/${order.id}`);
    await expect(line(other, 0).getByLabel("Quantity")).toHaveValue("3");

    await line(page, 0).getByTestId("register-medicine").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("register-submit").click();
    await expect(dialog).toBeHidden();
    await expect(line(page, 0).getByTestId("line-typed-name")).toBeVisible();

    await line(other, 0).getByLabel("Quantity").fill("9");
    await expect(other.getByTestId("save-status")).toHaveAttribute("data-state", "changed_elsewhere", { timeout: 15_000 });
    await expect(line(other, 0).getByLabel("Quantity")).toHaveValue("9"); // its text is not thrown away
    const stored = await freshTenant.client.from("order_lines").select("quantity, item_status").is("removed_at", null).order("position");
    expect(stored.data![0]).toEqual({ quantity: 3, item_status: "registered" });
  });

  test("with the connection failing the order is unchanged and an error with a way to retry is shown; retrying registers once", async ({ page, freshTenant }) => {
    const { order } = await setup(freshTenant);
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    let blocked = true;
    await page.route("**/api/orders/*/lines/*/register", (route) => (blocked ? route.abort() : route.continue()));
    await line(page, 0).getByTestId("register-medicine").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("register-submit").click();
    await expect(dialog.getByRole("alert")).toContainText("Can't reach the server");
    await expect(dialog).toBeVisible();
    const before = await freshTenant.client.rpc("order_get", { p_id: order.id });
    expect(before.data.lines[0].product_id).toBeNull();
    expect(before.data.version).toBe(order.version);

    blocked = false;
    await dialog.getByTestId("register-submit").click();
    await expect(dialog).toBeHidden();
    await expect(line(page, 0).getByTestId("line-typed-name")).toBeVisible();
    const made = await freshTenant.client.from("products").select("id").eq("name", "Noran 20mg cap");
    expect(made.data).toHaveLength(1);
  });

  test("no purchase price or MRP is shown on the order screen after registering with them", async ({ page, freshTenant }) => {
    const { order } = await setup(freshTenant);
    await signIn(page, freshTenant);
    await page.goto(`/orders/${order.id}`);
    await line(page, 0).getByTestId("register-medicine").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("register-more").click();
    await dialog.getByLabel("Purchase price (PKR)", { exact: true }).fill("90.00");
    await dialog.getByLabel("MRP (PKR)", { exact: true }).fill("130.00");
    await dialog.getByTestId("register-submit").click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await page.waitForLoadState("networkidle");
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/purchase|MRP|margin|profit|cost/i);
    expect(text).not.toMatch(/\b90\.00\b|\b130\.00\b/);
  });
});
