import { readFileSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { accountArgs } from "../helpers/accounts";
import { goOffline, goOnline, idbCount, waitDeviceReady } from "../helpers/offline";
import { accountStore, addOpening, balanceOfStore, TODAY } from "./account-helpers";
import { expect, signIn, test } from "./fixtures";
import { openPaymentScreen, paymentsOnServer, readPaymentOps, savePhonePayment } from "./payment-helpers";

// Module 011, US3 (SC-007 for payments): a backup file carries the payments waiting on the phone and nothing else about money;
// restoring never records a payment twice, also when the server already holds it, and a version 1 file restores as before.
test.describe("US3: backup and restore of waiting payments", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(240_000);

  const FORBIDDEN = /price|mrp|\bcost\b|margin|profit|balance|invoice|payment|ledger|token|password|cookie/i;
  const withoutPaymentKeys = (text: string) => text.replace(/"(payments|waitingPayments|paymentId)"/g, '""');

  async function exportFile(page: Page): Promise<{ path: string; text: string }> {
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("backup-export").click()]);
    const path = test.info().outputPath(download.suggestedFilename());
    await download.saveAs(path);
    return { path, text: readFileSync(path, "utf8") };
  }

  test("two waiting payments go into the file, come back after the phone is cleared, and are recorded once each, also the one the server already held", async ({ page, context, freshTenant }) => {
    const store = await accountStore(freshTenant, "Backup Pay Store");
    await addOpening(freshTenant, store.id, "20000.00", "owes");
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await openPaymentScreen(page);
    await savePhonePayment(page, { store: "Backup Pay Store", amount: "5000", reference: "R1" });
    await savePhonePayment(page, { amount: "2500", reference: "R2" });
    expect(await idbCount(page, "paymentOps")).toBe(2);
    const [first, second] = await readPaymentOps(page);

    // Back online, but payments cannot be sent, so both stay on the phone while the backup is made.
    let allowSend = false;
    await context.route(/\/api\/accounts\/[0-9a-f-]{36}\/payments$/, (route) => (allowSend ? route.continue() : route.abort("connectionreset")));
    await goOnline(context);
    await page.goto("/settings");
    const file = await exportFile(page);
    await expect(page.getByTestId("backup-export-done")).toContainText("2 payments, PKR 7,500.00 are in this file.");
    const json = JSON.parse(file.text) as { version: number; counts: Record<string, number>; waiting: { payments: Array<Record<string, unknown>> } };
    expect(json.version).toBe(2);
    expect(json.counts.waitingPayments).toBe(2);
    expect(json.waiting.payments.map((p) => Object.keys(p).sort())).toEqual([
      ["amount", "date", "paymentId", "reason", "reference", "storeId", "syncState"],
      ["amount", "date", "paymentId", "reason", "reference", "storeId", "syncState"],
    ]);
    expect(json.waiting.payments.map((p) => [p.paymentId, p.storeId, p.amount, p.reference, p.syncState])).toEqual([
      [first!.paymentId, store.id, "5000.00", "R1", "waiting"], // its sending was tried, so it waits for an answer
      [second!.paymentId, store.id, "2500.00", "R2", "on_device"], // held behind the first one of its store, never tried
    ]);
    // nothing about a balance, an invoice, the ledger or a price is in the file
    expect(withoutPaymentKeys(file.text)).not.toMatch(FORBIDDEN);

    // One of the two was in fact recorded by the server before the phone was cleared (its answer never came back).
    const already = await freshTenant.client.rpc("ledger_payment_add", accountArgs.payment(first!.paymentId, store.id, "5000.00", TODAY, "R1"));
    expect(already.data?.done).toBe(true);
    expect(await paymentsOnServer(store.id)).toHaveLength(1);

    // The data of the phone is cleared (after the warning), and the waiting payments are gone from it.
    await page.getByTestId("clear-device-data").click();
    await expect(page.getByTestId("export-offer")).toContainText("not on the server yet");
    await page.getByTestId("clear-device-data-confirm").click();
    await page.waitForLoadState("load");
    await page.goto("/settings");
    await expect(page.getByTestId("sync-empty")).toBeVisible();
    expect(await idbCount(page, "paymentOps")).toBe(0);

    // The preview names both payments and changes nothing until the supplier confirms.
    await page.getByTestId("backup-file").setInputFiles(file.path);
    await expect(page.getByTestId("import-preview")).toBeVisible();
    await expect(page.getByTestId("import-preview-payments")).toContainText("2 payments, PKR 7,500.00, will be kept on this phone and sent");
    await expect(page.getByTestId("import-preview-payments")).toContainText("a payment it already holds is not recorded again");
    await expect(page.getByTestId("import-group-new")).toContainText("Payment: ");
    expect(await idbCount(page, "paymentOps")).toBe(0);

    await page.getByTestId("import-confirm").click();
    await expect(page.getByTestId("import-result")).toContainText("2 payments");
    await expect.poll(() => idbCount(page, "paymentOps")).toBe(2);
    await page.goto("/settings");
    const cards = page.getByTestId("device-payment");
    await expect(cards).toHaveCount(2);
    for (const state of await cards.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-state")))) expect(["waiting"]).toContain(state);

    // The restored phone copy has no balance, invoice, ledger entry or cost either.
    const restored = await readPaymentOps(page);
    expect(restored.map((p) => p.paymentId).sort()).toEqual([first!.paymentId, second!.paymentId].sort());
    expect(JSON.stringify(restored)).not.toMatch(/balance|invoice|ledger|\bcost\b|margin|profit|mrp|price/i);

    // Sending resumes: each payment is recorded once, also the one the server already held.
    allowSend = true;
    await context.unroute(/\/api\/accounts\/[0-9a-f-]{36}\/payments$/);
    await expect.poll(() => idbCount(page, "paymentOps"), { timeout: 90_000 }).toBe(0);
    const entries = await paymentsOnServer(store.id);
    expect(entries.map((e) => e.id).sort()).toEqual([first!.paymentId, second!.paymentId].sort());
    expect(entries.map((e) => e.credit).sort()).toEqual(["2500.00", "5000.00"]);
    expect(await balanceOfStore(freshTenant, store.id)).toBe("12500.00");

    // Importing the same file again adds nothing: the payments are on the server and not on the phone, so they are queued and
    // sent as repeats of the same keys, and the server still holds exactly two entries.
    await page.goto("/settings");
    await page.getByTestId("backup-file").setInputFiles(file.path);
    await page.getByTestId("import-confirm").click();
    await expect(page.getByTestId("import-result")).toBeVisible();
    await expect.poll(() => idbCount(page, "paymentOps"), { timeout: 90_000 }).toBe(0);
    expect(await paymentsOnServer(store.id)).toHaveLength(2);
    expect(await balanceOfStore(freshTenant, store.id)).toBe("12500.00");
  });

  test("a version 1 backup file (made before payments existed) restores exactly as before and shows no payments", async ({ page, freshTenant }) => {
    await accountStore(freshTenant, "Old File Store");
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await page.goto("/settings");
    const file = await exportFile(page);
    const v1 = JSON.parse(file.text);
    v1.version = 1;
    delete v1.waiting.payments;
    delete v1.counts.waitingPayments;
    const v1Path = test.info().outputPath("version-1.json");
    writeFileSync(v1Path, JSON.stringify(v1));
    await page.getByTestId("backup-file").setInputFiles(v1Path);
    await expect(page.getByTestId("import-preview")).toBeVisible();
    await expect(page.getByTestId("import-preview-payments")).toHaveCount(0);
    await expect(page.getByTestId("import-confirm")).toBeDisabled();
    await expect(page.getByTestId("import-preview")).toContainText("Nothing would change");
    // a version 1 file that names payments is not a file the app wrote
    const bad = { ...v1, waiting: { ...v1.waiting, payments: [] } };
    const badPath = test.info().outputPath("version-1-payments.json");
    writeFileSync(badPath, JSON.stringify(bad));
    await page.getByTestId("backup-file").setInputFiles(badPath);
    await expect(page.getByTestId("backup-error")).toContainText("Nothing was imported");
  });
});
