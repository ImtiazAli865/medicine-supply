import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { goOffline, idbCount, idbGet, waitDeviceReady } from "../helpers/offline";
import { serviceClient, type TestTenant } from "../helpers/supabase-test";
import { expect, signIn, test } from "./fixtures";

// Module 011, US1: a cash payment can be recorded with no internet. It is kept on the phone, shown honestly as waiting, never
// recorded twice, never removed without a confirmation, and the screen never shows an amount owed (mobile, 360 px).
test.describe("US1: recording a payment without the internet", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(150_000);

  async function seedStore(tenant: TestTenant, name: string): Promise<string> {
    const id = randomUUID();
    const { error } = await serviceClient().from("stores").insert({ id, business_id: tenant.businessId, name });
    if (error) throw new Error(error.message);
    return id;
  }

  async function addStoreOffline(page: Page, name: string) {
    await page.goto("/orders/new");
    await page.getByTestId("add-new-store").click();
    await page.getByLabel("Store name").fill(name);
    await page.getByTestId("save-new-store").click();
    await expect(page.getByTestId("order-store")).toContainText(name);
  }

  async function openPaymentScreen(page: Page) {
    await page.goto("/offline");
    await page.getByTestId("offline-record-payment").click();
    await expect(page.getByTestId("offline-payment-screen")).toBeVisible();
    await expect(page.getByTestId("payment-store")).toBeVisible();
  }

  async function save(page: Page, fields: { amount?: string; date?: string; reference?: string }) {
    if (fields.amount !== undefined) await page.getByTestId("payment-amount").fill(fields.amount);
    if (fields.date !== undefined) await page.getByTestId("payment-date").fill(fields.date);
    if (fields.reference !== undefined) await page.getByTestId("payment-reference").fill(fields.reference);
    await page.getByTestId("payment-save").click();
  }

  test("keeps a payment on the phone as waiting, refuses bad input, and removes only after a confirmation", async ({ page, context, freshTenant }) => {
    await seedStore(freshTenant, "Pay Store A");
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await addStoreOffline(page, "Made Offline Store");

    // The shell's own address for the screen works too (a reload or a bookmark offline).
    await page.goto("/accounts/pay");
    await expect(page.getByTestId("offline-payment-screen")).toBeVisible();
    await openPaymentScreen(page);

    const store = page.getByTestId("payment-store");
    await expect(store.locator("option")).toHaveText(["Choose a store", "Made Offline Store (waiting to be sent)", "Pay Store A"]);

    // Offline the screen shows no amount owed and no preview, and says who works out what the payment settles.
    const screen = page.getByTestId("offline-payment-screen");
    await expect(screen).toContainText("The server works out what this payment settles when it is sent.");
    await expect(screen).not.toContainText(/balance/i);
    await expect(page.getByTestId("payment-preview-loading")).toHaveCount(0);

    // Refused with the online wording, and nothing is saved.
    const today = await page.getByTestId("payment-date").inputValue();
    await store.selectOption({ label: "Pay Store A" });
    await save(page, { amount: "0" });
    await expect(screen).toContainText("Enter an amount above 0 with at most two decimals.");
    await save(page, { amount: "100", date: "2999-01-01" });
    await expect(screen).toContainText("Choose a date up to today.");
    await save(page, { date: "1999-12-31" });
    await expect(screen).toContainText("Choose a date up to today.");
    // A reference of 101 characters (the field stops typing at 100, so the value is set the way a paste or a script would)
    await page.getByTestId("payment-date").fill(today);
    await page.getByTestId("payment-reference").evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(el, "x".repeat(101));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.getByTestId("payment-save").click();
    await expect(screen).toContainText("Use at most 100 characters.");
    await page.getByTestId("payment-reference").fill("");
    expect(await idbCount(page, "paymentOps")).toBe(0);
    await expect(page.getByTestId("device-payment")).toHaveCount(0);
    await expect(page.getByTestId("payments-none-waiting")).toBeVisible();

    // A valid payment: kept as waiting, with the honest sentence, and never called recorded or synced.
    await save(page, { amount: "5000", date: today, reference: "R1" });
    await expect(page.getByTestId("payment-saved")).toContainText("Saved on this phone. It is not in the store's account until it is sent.");
    const card = page.getByTestId("device-payment");
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute("data-state", "waiting");
    await expect(card).toContainText("PKR 5,000.00");
    await expect(card).toContainText("Pay Store A");
    await expect(card).toContainText("Reference R1");
    await expect(card).toContainText("Waiting");
    await expect(screen).not.toContainText(/\b(recorded|synced)\b/i);
    expect(await idbCount(page, "paymentOps")).toBe(1);

    // A double tap makes one payment.
    await page.getByTestId("payment-amount").fill("300");
    await page.getByTestId("payment-save").dblclick();
    await expect(page.getByTestId("device-payment")).toHaveCount(2);
    expect(await idbCount(page, "paymentOps")).toBe(2);

    // Closing the page right after Save never leaves two copies of one payment.
    await page.getByTestId("payment-amount").fill("400");
    await page.getByTestId("payment-save").click();
    await page.reload();
    const after = await idbCount(page, "paymentOps");
    expect(after === 2 || after === 3).toBe(true);

    // After a reload offline every saved payment is still there, with the same values.
    await openPaymentScreen(page);
    await page.getByTestId("payment-store").selectOption({ label: "Pay Store A" });
    await expect(page.getByTestId("device-payment")).toHaveCount(after);
    await expect(page.getByTestId("payments-waiting-total")).toContainText(`${after} payments waiting on this phone`);
    await expect(page.getByTestId("payments-waiting-total")).toContainText("not counted yet");

    // Remove asks first, names the amount and the store, and removes nothing until it is confirmed.
    const first = page.getByTestId("device-payment").first();
    await first.getByTestId("device-payment-remove").click();
    const confirm = page.getByTestId("device-payment-confirm");
    await expect(confirm).toContainText("PKR 5,000.00");
    await expect(confirm).toContainText("Pay Store A");
    await expect(confirm).toContainText("cannot be undone");
    await page.getByTestId("device-payment-remove-cancel").click();
    await expect(page.getByTestId("device-payment")).toHaveCount(after);
    expect(await idbCount(page, "paymentOps")).toBe(after);
    await first.getByTestId("device-payment-remove").click();
    await page.getByTestId("device-payment-remove-confirm").click();
    await expect(page.getByTestId("device-payment")).toHaveCount(after - 1);
    expect(await idbCount(page, "paymentOps")).toBe(after - 1);
  });

  test("the payment of a store made offline stays on the phone for that store", async ({ page, context, freshTenant }) => {
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    await addStoreOffline(page, "Only Offline Store");
    await openPaymentScreen(page);
    await page.getByTestId("payment-store").selectOption({ label: "Only Offline Store (waiting to be sent)" });
    await save(page, { amount: "250.5" });
    const card = page.getByTestId("device-payment");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("PKR 250.50");
    const record = (await page.evaluate(async () => {
      const dbs = (await indexedDB.databases?.()) ?? [];
      const name = dbs.find((d) => d.name?.startsWith("medsupply-") && d.name !== "medsupply-registry")?.name;
      if (!name) throw new Error("no business database");
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const rows = await new Promise<Array<Record<string, unknown>>>((resolve) => {
        const req = db.transaction("paymentOps", "readonly").objectStore("paymentOps").getAll();
        req.onsuccess = () => resolve(req.result as Array<Record<string, unknown>>);
      });
      db.close();
      return rows;
    })) as Array<{ storeId: string; amount: string; state: string; attempted: boolean }>;
    expect(record).toHaveLength(1);
    expect(record[0]).toMatchObject({ amount: "250.50", state: "on_device", attempted: false });
    // it belongs to the store made on the phone, the same id the store operation keeps
    expect(await idbGet(page, "storeOps", record[0]!.storeId)).toBeDefined();
  });

  test("a database written by version 1 of the app upgrades to version 2 with everything intact", async ({ page, context, freshTenant }) => {
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);
    const storeId = randomUUID();
    const draftId = randomUUID();
    const lineId = randomUUID();
    // Rebuild this business's phone database exactly as version 1 made it, with a store made offline and its store operation.
    await page.evaluate(async ({ id, draftId, lineId }) => {
      const dbs = (await indexedDB.databases?.()) ?? [];
      const name = dbs.find((d) => d.name?.startsWith("medsupply-") && d.name !== "medsupply-registry")?.name;
      if (!name) throw new Error("no business database");
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => setTimeout(resolve, 1500);
      });
      const keyPaths: Record<string, string> = { meta: "key", medicines: "id", stores: "id", storeExtras: "storeId", drafts: "orderId", storeOps: "storeId" };
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => {
          for (const [store, keyPath] of Object.entries(keyPaths)) req.result.createObjectStore(store, { keyPath });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction(["stores", "storeOps", "meta", "drafts"], "readwrite");
      tx.objectStore("stores").put({ id, name: "Version One Store", contact_person: null, phone: null, address: null, is_active: true, pending: true });
      tx.objectStore("storeOps").put({
        storeId: id,
        rev: 1,
        seq: 1,
        payload: { id, name: "Version One Store", contact_person: null, phone: null, address: null, notes: null },
        confirmDuplicate: false,
        state: "on_device",
        reason: null,
        matches: [],
        tries: 0,
        nextTryTick: 0,
      });
      tx.objectStore("meta").put({ key: "schemaVersion", value: 1 });
      tx.objectStore("drafts").put({
        orderId: draftId,
        rev: 1,
        seq: 1,
        state: { storeId: id, notes: "kept from version 1", lines: [{ id: lineId, product_id: null, name: "Typed In Version One", quantity: 3, unit: "box" }] },
        lineInfo: {},
        baseVersion: null,
        inflight: null,
        serverOrder: null,
        syncState: "on_device",
        reason: null,
        conflict: null,
        tries: 0,
        nextTryTick: 0,
        neverSent: true,
        updatedOnDevice: "t",
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, { id: storeId, draftId, lineId });

    await page.reload();
    await openPaymentScreen(page);
    const info = await page.evaluate(async () => {
      const dbs = (await indexedDB.databases?.()) ?? [];
      const found = dbs.find((d) => d.name?.startsWith("medsupply-") && d.name !== "medsupply-registry")!;
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open(found.name!);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const result = { version: db.version, stores: Array.from(db.objectStoreNames).sort() };
      db.close();
      return result;
    });
    expect(info.version).toBe(2);
    expect(info.stores).toEqual(["drafts", "medicines", "meta", "paymentOps", "storeExtras", "storeOps", "stores"]);
    expect(await idbGet(page, "stores", storeId)).toMatchObject({ name: "Version One Store", pending: true });
    expect(await idbGet(page, "storeOps", storeId)).toMatchObject({ state: "on_device", payload: { name: "Version One Store" } });
    expect(await idbGet(page, "drafts", draftId)).toMatchObject({ orderId: draftId, neverSent: true, state: { notes: "kept from version 1", lines: [{ name: "Typed In Version One", quantity: 3 }] } });
    expect(await idbCount(page, "drafts")).toBe(1);
    expect(await idbCount(page, "paymentOps")).toBe(0);
    // and a payment can be saved for the store that came from version 1
    await page.getByTestId("payment-store").selectOption({ label: "Version One Store (waiting to be sent)" });
    await save(page, { amount: "10" });
    await expect(page.getByTestId("device-payment")).toHaveCount(1);
    expect(await idbCount(page, "paymentOps")).toBe(1);
  });
});
