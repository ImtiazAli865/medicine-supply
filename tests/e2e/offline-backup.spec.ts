import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { insertMedicines } from "../helpers/fast";
import { countOrders, goOffline, goOnline, linesOnServer, ordersOnServer, readJournal, waitDeviceReady } from "../helpers/offline";
import type { TestTenant } from "../helpers/supabase-test";
import { createOrder, seedStore } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// US5 of Module 009 (SC-007): export and import a backup with a preview, no duplicates, no newer server data overwritten, and no
// price or secret inside the file (mobile, 360 px).
test.describe("US5: backup and restore", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(180_000);

  // Since version 2 the file has the keys "payments" and "waitingPayments" (the cash payments waiting on the phone, only what was typed).
  // Every other mention of money, and every price, balance, invoice, ledger or secret, is still forbidden.
  const FORBIDDEN = /price|mrp|\bcost\b|margin|profit|balance|invoice|payment|ledger|token|password|cookie/i;
  const withoutPaymentKeys = (text: string) => text.replace(/"(payments|waitingPayments|paymentId)"/g, '""');

  async function seed(tenant: TestTenant) {
    const [m1] = await insertMedicines(tenant.client, [{ name: "Backup Med", strength: "10 mg", selling_price: "10.00" }]);
    const storeId = await seedStore(tenant, "Backup Store");
    const confirmed = await createOrder(tenant, storeId, [{ product_id: m1!, quantity: 4, unit: "strip" }], { confirm: true });
    const draft = await createOrder(tenant, storeId, [{ product_id: m1!, quantity: 1, unit: "box" }]);
    return { storeId, medicineId: m1!, confirmedId: confirmed.id, draftId: draft.id };
  }

  /** An order that exists only on the phone: taken offline, and kept from being sent while the test runs. */
  async function waitingOrder(page: Page, context: Parameters<typeof goOffline>[0]) {
    await goOffline(context);
    await page.goto("/orders/new");
    await page.getByTestId("store-option").filter({ hasText: "Backup Store" }).first().click();
    await page.getByTestId("fast-search").fill("Backup Med");
    await page.getByTestId("medicine-result").first().click();
    await page.getByTestId("fast-quantity").fill("7");
    await page.getByTestId("fast-quantity").press("Enter");
    await page.getByTestId("fast-search").fill("Typed Backup Item");
    await page.getByTestId("add-as-typed").click();
    const form = page.getByTestId("typed-form");
    await form.getByLabel("Quantity").fill("2");
    await form.getByLabel("Unit").fill("box");
    await form.getByTestId("add-typed-line").click();
    await expect(page.getByTestId("order-line")).toHaveCount(2);
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "on_device");
  }

  async function exportFile(page: Page): Promise<{ path: string; text: string; name: string }> {
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("backup-export").click()]);
    const path = test.info().outputPath(download.suggestedFilename());
    await download.saveAs(path);
    return { path, text: readFileSync(path, "utf8"), name: download.suggestedFilename() };
  }

  test("export holds the stores, orders and the waiting order but no price or secret; clear the device; import shows a preview, changes nothing until confirmed, sends the order once; importing again creates nothing", async ({ page, context, freshTenant }) => {
    const s = await seed(freshTenant);
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await waitingOrder(page, context);
    // sending stays cut while the test runs, so the order stays on the phone only
    let allowSend = false;
    await context.route(/\/api\/orders\/[0-9a-f-]{36}$/, (route) => (route.request().method() === "PUT" && !allowSend ? route.abort("connectionreset") : route.continue()));
    await goOnline(context);

    await page.goto("/settings");
    await expect(page.getByTestId("sync-status")).toBeVisible();
    const file = await exportFile(page);
    expect(file.name).toMatch(/^medsupply-backup-\d{4}-\d{2}-\d{2}\.json$/);
    await expect(page.getByTestId("backup-export-done")).toContainText("1 waiting orders");
    const json = JSON.parse(file.text) as { source: string; counts: Record<string, number>; businessId: string };
    expect(json.source).toBe("server+device");
    expect(json.counts).toMatchObject({ stores: 1, orders: 2, waitingOrders: 1 });
    expect(withoutPaymentKeys(file.text)).not.toMatch(FORBIDDEN);

    // the data of this phone is cleared (after a warning that offers the backup): the waiting order is gone from the phone
    await page.getByTestId("clear-device-data").click();
    await expect(page.getByTestId("export-offer")).toContainText("not on the server yet");
    await page.getByTestId("clear-device-data-confirm").click();
    await page.waitForLoadState("load");
    await page.goto("/settings");
    await expect(page.getByTestId("sync-empty")).toBeVisible();
    expect((await readJournal(page)).length).toBe(0);
    expect(await countOrders(freshTenant)).toBe(2);

    // import: the preview changes nothing until the supplier confirms
    await page.getByTestId("backup-file").setInputFiles(file.path);
    const preview = page.getByTestId("import-preview");
    await expect(preview).toBeVisible();
    await expect(page.getByTestId("import-group-new")).toContainText("Order");
    await expect(page.getByTestId("import-group-already_on_server")).toContainText("Backup Store");
    expect((await readJournal(page)).length).toBe(0);
    expect(await countOrders(freshTenant)).toBe(2);

    await page.getByTestId("import-confirm").click();
    await expect(page.getByTestId("import-result")).toContainText("1 order");
    await expect.poll(async () => (await readJournal(page)).length).toBe(1);

    // the imported order is sent by the normal queue, once, with its exact lines
    allowSend = true;
    await expect.poll(() => countOrders(freshTenant), { timeout: 60_000 }).toBe(3);
    const created = (await ordersOnServer(freshTenant)).find((o) => o.id !== s.confirmedId && o.id !== s.draftId)!;
    expect((await linesOnServer(created.id)).map((l) => [l.name, l.quantity, l.unit])).toEqual([
      ["Backup Med", 7, "strip"],
      ["Typed Backup Item", 2, "box"],
    ]);

    // importing the same file again creates nothing: the order is already on the server
    await page.goto("/settings");
    await page.getByTestId("backup-file").setInputFiles(file.path);
    await expect(page.getByTestId("import-preview")).toBeVisible();
    await expect(page.getByTestId("import-confirm")).toBeDisabled();
    await expect(page.getByTestId("import-preview")).toContainText("Nothing would change");
    expect(await countOrders(freshTenant)).toBe(3);
  });

  test("a damaged file, a file of another business and a file of an unknown version are refused with a plain reason and nothing is imported", async ({ page, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await page.goto("/settings");
    const good = await exportFile(page);

    const damaged = test.info().outputPath("damaged.json");
    writeFileSync(damaged, "{ this is not a backup");
    await page.getByTestId("backup-file").setInputFiles(damaged);
    await expect(page.getByTestId("backup-error")).toContainText("Nothing was imported");

    const other = test.info().outputPath("other.json");
    writeFileSync(other, JSON.stringify({ ...JSON.parse(good.text), businessId: randomUUID() }));
    await page.getByTestId("backup-file").setInputFiles(other);
    await expect(page.getByTestId("backup-error")).toContainText("belongs to another business");

    const future = test.info().outputPath("future.json");
    writeFileSync(future, JSON.stringify({ ...JSON.parse(good.text), version: 99 }));
    await page.getByTestId("backup-file").setInputFiles(future);
    await expect(page.getByTestId("backup-error")).toContainText("different version");

    const withPrice = test.info().outputPath("with-price.json");
    const poisoned = JSON.parse(good.text);
    poisoned.orders[0].lines[0].purchase_price = "5.00";
    writeFileSync(withPrice, JSON.stringify(poisoned));
    await page.getByTestId("backup-file").setInputFiles(withPrice);
    await expect(page.getByTestId("backup-error")).toContainText("Nothing was imported");
    await expect(page.getByTestId("import-preview")).toHaveCount(0);
    expect((await readJournal(page)).length).toBe(0);
  });

  test("an item in the file that is older than the server copy is shown as a conflict, and the server copy is unchanged after the import", async ({ page, freshTenant }) => {
    const s = await seed(freshTenant);
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await page.goto("/settings");
    const file = await exportFile(page);
    // the server draft is changed after the backup was made
    const { data: current } = await freshTenant.client.rpc("order_get", { p_id: s.draftId });
    const saved = await freshTenant.client.rpc("order_save", {
      p_id: s.draftId,
      p_request_id: randomUUID(),
      p_expected_version: current.version,
      p_store_id: s.storeId,
      p_notes: "changed after the backup",
      p_lines: [{ id: randomUUID(), product_id: s.medicineId, name: null, quantity: 9, unit: "box" }],
    });
    expect(saved.data.saved).toBe(true);
    await page.getByTestId("backup-file").setInputFiles(file.path);
    await expect(page.getByTestId("import-group-conflict")).toContainText("server copy");
    const before = await linesOnServer(s.draftId);
    // nothing new would be added, so there is nothing to confirm
    await expect(page.getByTestId("import-confirm")).toBeDisabled();
    expect(await linesOnServer(s.draftId)).toEqual(before);
    expect(before[0]).toMatchObject({ quantity: 9 });
  });

  test("a backup made offline says it holds only what the phone has", async ({ page, context, freshTenant }) => {
    await seed(freshTenant);
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await page.goto("/settings");
    await expect(page.getByTestId("sync-online")).toContainText("Offline");
    const file = await exportFile(page);
    expect(JSON.parse(file.text).source).toBe("device-only");
    await expect(page.getByTestId("backup-export-done")).toContainText("made offline");
    // importing needs the internet, and says so
    await page.getByTestId("backup-file").setInputFiles(file.path);
    await expect(page.getByTestId("backup-error")).toContainText("needs the internet");
  });
});
