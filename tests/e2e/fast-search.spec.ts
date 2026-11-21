import { insertMedicines, seedSimilar } from "../helpers/fast";
import { addMedicine, line, seedStore, startOrder, waitSaved } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";
import { blockDeviceStorage } from "../helpers/offline";

// US3 of Module 008: the search box that stays on the order screen (mobile, 360 px).
test.describe("US3: continuous search", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  async function seed(tenant: import("../helpers/supabase-test").TestTenant) {
    const similar = await seedSimilar(tenant.client);
    const [brufen] = await insertMedicines(tenant.client, [
      { name: "Brufen", strength: "400 mg", dosage_form: "tablet", pack_size: "20", manufacturer: "Abbott" },
      { name: "Calpol", strength: "120 mg", dosage_form: "syrup", pack_size: "60 ml", manufacturer: "GSK" },
    ]);
    await seedStore(tenant, "Search Store");
    return { similar, brufen: brufen! };
  }

  test("letters, Enter, quantity, Enter: no dialog opens, the cursor goes to the quantity and back to the search box", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    const bodies: string[] = [];
    page.on("response", async (response) => {
      if (/\/api\/orders\/medicines\?/.test(response.url())) bodies.push(await response.text());
    });
    await startOrder(page, "Search Store");
    const box = page.getByTestId("fast-search");
    const quantity = page.getByTestId("fast-quantity");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Three letters (3 key presses): exactly one medicine is left, so it is highlighted.
    await box.click();
    await page.keyboard.type("bru");
    await expect(page.getByTestId("medicine-result")).toHaveCount(1);
    await expect(page.getByTestId("medicine-result")).toHaveAttribute("data-highlighted", "true");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Enter (1 key press) chooses it: the box clears and the cursor is in the quantity with the 1 selected.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("fast-chosen")).toContainText("Brufen");
    await expect(box).toHaveValue("");
    await expect(quantity).toBeFocused();
    await expect(quantity).toHaveValue("1");
    const selection = await quantity.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]);
    expect(selection).toEqual([0, 1]);
    await expect(page.getByTestId("order-line")).toHaveCount(0); // nothing was added yet

    // The typed number replaces the 1 (1 key press), Enter (1 key press) adds the line and returns to the search box.
    await page.keyboard.type("5");
    await page.keyboard.press("Enter");
    await expect(box).toBeFocused();
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await expect(line(page, 0).getByLabel("Quantity")).toHaveValue("5");
    await expect(line(page, 0)).toContainText("400 mg");
    await expect(page.getByTestId("fast-chosen")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // SC-004: letters + Enter + quantity + Enter = 6 key presses and no tap; no dialog was ever opened.
    await waitSaved(page);
    // SC-007: the medicine list that was loaded has no purchase price, MRP or cost, although the medicines have them.
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(body).not.toMatch(/purchase|mrp|cost|margin|profit|snapshot|31[.]00|60[.]00/i);
  });

  test("with several matches nothing is highlighted and Enter adds nothing; the arrow keys choose, and Enter adds exactly that one", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Search Store");
    const box = page.getByTestId("fast-search");
    await box.fill("panadol");
    const results = page.getByTestId("medicine-result");
    await expect(results).toHaveCount(4);
    for (let i = 0; i < 4; i += 1) await expect(results.nth(i)).toHaveAttribute("data-highlighted", "false");

    await box.press("Enter");
    await expect(page.getByTestId("fast-chosen")).toHaveCount(0);
    await expect(page.getByTestId("order-line")).toHaveCount(0);

    await box.press("ArrowDown");
    await box.press("ArrowDown");
    await expect(results.nth(1)).toHaveAttribute("data-highlighted", "true");
    const details = (await results.nth(1).innerText()).split("\n")[1]!;
    await box.press("Enter");
    await expect(page.getByTestId("fast-chosen")).toContainText(details);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await expect(line(page, 0)).toContainText(details.split(" · ")[0]!);
  });

  test("digits are part of the search: 'panadol 500' narrows to that strength and is never a quantity", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Search Store");
    const box = page.getByTestId("fast-search");
    await box.fill("panadol 500");
    const results = page.getByTestId("medicine-result");
    await expect(results).toHaveCount(3);
    for (let i = 0; i < 3; i += 1) await expect(results.nth(i)).toContainText("500 mg");
    await expect(page.getByTestId("order-line")).toHaveCount(0);
    await box.press("Enter"); // three results: nothing is chosen
    await expect(page.getByTestId("fast-chosen")).toHaveCount(0);
    await box.fill("panadol 500 syrup");
    await expect(results).toHaveCount(1);
    await expect(results.first()).toHaveAttribute("data-highlighted", "true");
  });

  test("a just-added line shows an Undo that removes only that line", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Search Store");
    await addMedicine(page, "brufen", "Brufen");
    await addMedicine(page, "calpol", "Calpol");
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await expect(page.getByTestId("undo-bar")).toContainText("Added Calpol");
    await page.getByTestId("undo-action").click();
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await expect(line(page, 0)).toContainText("Brufen");
    await waitSaved(page);
  });

  test("when nothing matches, 'Add as typed' is offered inline and the typed line is added and the cursor returns to the search box", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Search Store");
    await page.getByTestId("fast-search").fill("zzz unknown tonic");
    await expect(page.getByTestId("no-matching-medicine")).toBeVisible();
    await expect(page.getByTestId("add-as-typed")).toContainText("Add as typed");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByTestId("add-as-typed").click();
    const form = page.getByTestId("typed-form");
    await form.getByLabel("Quantity").fill("3");
    await form.getByLabel("Unit").fill("bottle");
    await form.getByTestId("add-typed-line").click();
    await expect(page.getByTestId("order-line")).toHaveCount(1);
    await expect(line(page, 0)).toContainText("Not registered");
    await expect(line(page, 0).getByLabel("Medicine name")).toHaveValue("zzz unknown tonic");
    await expect(page.getByTestId("fast-search")).toBeFocused();
    await waitSaved(page);
  });

  test("results come from the device once the list is loaded (no request per keystroke)", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await startOrder(page, "Search Store");
    await expect(page.getByTestId("refresh-medicines")).toBeVisible({ timeout: 20_000 }); // the list is complete
    const searches: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/orders\/medicines\?.*q=/.test(request.url())) searches.push(request.url());
    });
    await page.getByTestId("fast-search").fill("brufen");
    await expect(page.getByTestId("medicine-result")).toHaveCount(1);
    await page.getByTestId("fast-search").fill("calpol");
    await expect(page.getByTestId("medicine-result")).toHaveCount(1);
    expect(searches).toEqual([]);
  });

  test("while the list cannot load the server search answers; previous results stay while a search is slow; a failed search shows Retry and keeps the text", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await blockDeviceStorage(page); // this test checks the online failure state, with no copy kept on the device
    await signIn(page, freshTenant);
    let listMode: "fail" | "ok" = "fail";
    let searchMode: "ok" | "slow" | "fail" = "ok";
    await page.route(/\/api\/orders\/medicines\?/, async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.has("q")) {
        if (searchMode === "fail") return route.abort("failed");
        if (searchMode === "slow") await new Promise((resolve) => setTimeout(resolve, 2000));
        return route.continue();
      }
      return listMode === "fail" ? route.abort("failed") : route.continue();
    });
    await startOrder(page, "Search Store");
    await expect(page.getByTestId("list-error")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("order-line")).toHaveCount(0); // the order screen itself is intact

    const box = page.getByTestId("fast-search");
    const results = page.getByTestId("medicine-result");
    await box.fill("panadol");
    await expect(results).toHaveCount(4);

    searchMode = "slow";
    await box.fill("panadol 500");
    await page.waitForTimeout(600);
    await expect(results).toHaveCount(4); // the previous results stay while the new search loads
    await expect(results).toHaveCount(3, { timeout: 10_000 });

    searchMode = "fail";
    await box.fill("panadol 500 syrup");
    await expect(page.getByTestId("search-error")).toBeVisible({ timeout: 10_000 });
    await expect(box).toHaveValue("panadol 500 syrup"); // the text is kept
    await expect(results).toHaveCount(3);

    searchMode = "ok";
    await page.getByTestId("search-error").getByRole("button", { name: "Retry" }).click();
    await expect(results).toHaveCount(1);

    listMode = "ok";
    await page.getByTestId("list-retry").click();
    await expect(page.getByTestId("list-error")).toHaveCount(0);
    await expect(page.getByTestId("refresh-medicines")).toBeVisible({ timeout: 20_000 });
  });
});
