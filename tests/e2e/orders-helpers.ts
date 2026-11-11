import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import type { TestTenant } from "../helpers/supabase-test";
import { expect } from "./fixtures";

// Shared steps for the order screens (Playwright).

export interface SeededCatalog {
  pricedId: string;
  sellingOnlyId: string;
  noPriceId: string;
}

/** Three medicines (all prices, selling price only, no price) in a business, through its own signed-in client. */
export async function seedMedicines(tenant: TestTenant): Promise<SeededCatalog> {
  const ids = { pricedId: randomUUID(), sellingOnlyId: randomUUID(), noPriceId: randomUUID() };
  const { error } = await tenant.client.from("products").insert([
    { id: ids.pricedId, name: "Panadol 500mg", unit: "strip", strength: "500 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK", purchase_price: "90.00", selling_price: "125.50", mrp: "130.00" },
    { id: ids.sellingOnlyId, name: "Brufen 400mg", unit: "box", strength: "400 mg", dosage_form: "tablet", selling_price: "310.00" },
    { id: ids.noPriceId, name: "Calpol Syrup", unit: "bottle", dosage_form: "syrup" },
  ]);
  if (error) throw new Error(`seed medicines: ${error.message}`);
  return ids;
}

export async function seedStore(tenant: TestTenant, name = "Al Shifa Pharmacy"): Promise<string> {
  const id = randomUUID();
  const { error } = await tenant.client.from("stores").insert({ id, name });
  if (error) throw new Error(`seed store: ${error.message}`);
  return id;
}

/** Opens a new order for the store with this name, through the store selector. */
export async function startOrder(page: Page, storeName: string): Promise<void> {
  await page.goto("/orders/new");
  await page.getByTestId("store-option").filter({ hasText: storeName }).first().click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?store=/);
  await expect(page.getByTestId("order-store")).toContainText(storeName);
}

/** Searches the catalog in the "Add medicine" dialog and picks the first result that contains `name`. */
export async function addMedicine(page: Page, search: string, name = search): Promise<void> {
  await page.getByTestId("add-medicine").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Search medicines").fill(search);
  await dialog.getByTestId("medicine-result").filter({ hasText: name }).first().click();
  await expect(dialog).toBeHidden();
}

export function line(page: Page, index: number): Locator {
  return page.getByTestId("order-line").nth(index);
}

export async function setQuantity(page: Page, index: number, quantity: string): Promise<void> {
  await line(page, index).getByLabel("Quantity").fill(quantity);
}

/** Waits until the screen says the change is saved (the server confirmed it). */
export async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved", { timeout: 15_000 });
}

export async function confirmOrder(page: Page): Promise<void> {
  await page.getByTestId("confirm-order").click();
  await page.getByTestId("confirm-order-yes").click();
  await expect(page.getByTestId("order-status")).toContainText("Confirmed", { timeout: 15_000 });
}

export interface CreatedOrder {
  id: string;
  number: number;
  version: number;
}

/** Creates an order directly through the database function as the tenant's own signed-in user (fast set-up). */
export async function createOrder(
  tenant: TestTenant,
  storeId: string,
  lines: Array<{ product_id: string | null; name?: string; quantity: number; unit: string }>,
  options: { confirm?: boolean; notes?: string } = {},
): Promise<CreatedOrder> {
  const id = randomUUID();
  const saved = await tenant.client.rpc("order_save", {
    p_id: id,
    p_request_id: randomUUID(),
    p_expected_version: null,
    p_store_id: storeId,
    p_notes: options.notes ?? null,
    p_lines: lines.map((l) => ({ id: randomUUID(), product_id: l.product_id, name: l.name ?? null, quantity: l.quantity, unit: l.unit })),
  });
  if (saved.error || !saved.data?.saved) throw new Error(`createOrder: ${saved.error?.message ?? JSON.stringify(saved.data)}`);
  let order = saved.data.order as { order_number: number; version: number };
  if (options.confirm) {
    const confirmed = await tenant.client.rpc("order_confirm", { p_id: id, p_request_id: randomUUID(), p_expected_version: order.version });
    if (confirmed.error || !confirmed.data?.confirmed) throw new Error(`confirm: ${confirmed.error?.message ?? JSON.stringify(confirmed.data)}`);
    order = confirmed.data.order;
  }
  return { id, number: order.order_number, version: order.version };
}
