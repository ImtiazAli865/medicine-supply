import type { Page } from "@playwright/test";
import { idbCount } from "../helpers/offline";
import { serviceClient } from "../helpers/supabase-test";
import { expect } from "./fixtures";

// Shared steps of the Module 011 browser tests of payments recorded on the phone.

/** Opens the offline Record payment screen from the offline home (client side, as the supplier does). */
export async function openPaymentScreen(page: Page): Promise<void> {
  await page.goto("/offline");
  await page.getByTestId("offline-record-payment").click();
  await expect(page.getByTestId("offline-payment-screen")).toBeVisible();
  await expect(page.getByTestId("payment-store")).toBeVisible();
}

/** Fills the Record payment form on the phone and presses Save payment. */
export async function savePhonePayment(page: Page, fields: { store?: string; amount: string; date?: string; reference?: string }): Promise<void> {
  if (fields.store !== undefined) await page.getByTestId("payment-store").selectOption({ label: fields.store });
  await page.getByTestId("payment-amount").fill(fields.amount);
  if (fields.date !== undefined) await page.getByTestId("payment-date").fill(fields.date);
  if (fields.reference !== undefined) await page.getByTestId("payment-reference").fill(fields.reference);
  await page.getByTestId("payment-save").click();
  // A saved payment clears the amount: wait for that, so the next payment is never typed while this one is being written.
  await expect(page.getByTestId("payment-amount")).toHaveValue("");
  await expect(page.getByTestId("payment-saved")).toBeVisible();
}

/** Records several payments for one store on the phone, one after another. */
export async function recordOnPhone(page: Page, store: string, amounts: string[]): Promise<void> {
  await openPaymentScreen(page);
  await page.getByTestId("payment-store").selectOption({ label: store });
  let saved = await idbCount(page, "paymentOps");
  for (const amount of amounts) {
    await savePhonePayment(page, { amount });
    saved += 1;
    await expect.poll(() => idbCount(page, "paymentOps")).toBe(saved);
  }
}

export interface PhonePayment {
  paymentId: string;
  storeId: string;
  amount: string;
  state: string;
  conflict: string | null;
  attempted: boolean;
  seq: number;
}

/** Every waiting payment of the phone's database of the signed-in business, read straight from IndexedDB, in recorded order. */
export async function readPaymentOps(page: Page): Promise<PhonePayment[]> {
  const rows = await page.evaluate(async () => {
    const dbs = (await indexedDB.databases?.()) ?? [];
    const name = dbs.find((d) => d.name?.startsWith("medsupply-") && d.name !== "medsupply-registry")?.name;
    if (!name) return [];
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      if (!db.objectStoreNames.contains("paymentOps")) return [];
      return await new Promise<unknown[]>((resolve, reject) => {
        const req = db.transaction("paymentOps", "readonly").objectStore("paymentOps").getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  });
  return (rows as PhonePayment[]).sort((a, b) => a.seq - b.seq);
}

export interface ServerPayment {
  id: string;
  store_id: string;
  credit: string;
  entry_date: string;
  reference: string | null;
}

/** The payment entries of a store on the server (read with the service role, so the test sees the truth), oldest first. */
export async function paymentsOnServer(storeId: string): Promise<ServerPayment[]> {
  const { data, error } = await serviceClient()
    .from("ledger_entries")
    .select("id,store_id,credit,entry_date,reference,created_at")
    .eq("store_id", storeId)
    .eq("entry_type", "payment")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`payments on server: ${error.message}`);
  // The service API sends numeric columns as numbers: write the amount as the app does, with two decimals.
  return ((data ?? []) as Array<Omit<ServerPayment, "credit"> & { credit: number | string }>).map((row) => ({ ...row, credit: Number(row.credit).toFixed(2) }));
}
