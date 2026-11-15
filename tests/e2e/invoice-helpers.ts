import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { TestTenant } from "../helpers/supabase-test";
import { expect } from "./fixtures";
import { createOrder, seedMedicines, seedStore, type CreatedOrder, type SeededCatalog } from "./orders-helpers";

// Shared set-up and steps for the Module 006 browser tests (invoices, printing, order sheets).

export interface InvoiceSeed extends SeededCatalog {
  storeId: string;
  storeName: string;
}

/** One store and the three medicines (Panadol 125.50, Brufen 310.00, Calpol with no price). */
export async function seedInvoiceWorld(tenant: TestTenant, storeName = "Al Madina Medical"): Promise<InvoiceSeed> {
  const catalog = await seedMedicines(tenant);
  const storeId = await seedStore(tenant, storeName);
  return { ...catalog, storeId, storeName };
}

/** A confirmed order: by default 10 x Panadol (strip) and 5 x Brufen (box), total PKR 2,805.00. */
export async function confirmedOrder(
  tenant: TestTenant,
  seed: InvoiceSeed,
  lines?: Array<{ product_id: string | null; name?: string; quantity: number; unit: string }>,
): Promise<CreatedOrder> {
  return createOrder(
    tenant,
    seed.storeId,
    lines ?? [
      { product_id: seed.pricedId, quantity: 10, unit: "strip" },
      { product_id: seed.sellingOnlyId, quantity: 5, unit: "box" },
    ],
    { confirm: true },
  );
}

/** Opens the order screen, taps "Create invoice" and waits for the draft screen. Returns the invoice id. */
export async function createDraftFromOrder(page: Page, orderId: string): Promise<string> {
  await page.goto(`/orders/${orderId}`);
  await page.getByTestId("create-invoice").click();
  await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("invoice-editor")).toBeVisible();
  return page.url().split("/").pop() as string;
}

export function invoiceLine(page: Page, index: number) {
  return page.getByTestId("invoice-line").nth(index);
}

export async function setDelivered(page: Page, index: number, value: string): Promise<void> {
  await invoiceLine(page, index).getByTestId("delivered-input").fill(value);
}

/** Saves the typed quantities and waits until the server answered (the "update after you save" note is gone). */
export async function saveQuantities(page: Page): Promise<void> {
  await page.getByTestId("save-quantities").click();
  await expect(page.getByTestId("totals-after-save")).toBeHidden({ timeout: 15_000 });
}

/** Issues the draft that is on screen and waits for the frozen invoice. Returns the invoice number text. */
export async function issueDraft(page: Page): Promise<string> {
  await page.getByTestId("issue-invoice").click();
  await page.getByTestId("issue-confirm").click();
  await expect(page.getByTestId("invoice-view")).toBeVisible({ timeout: 15_000 });
  const heading = (await page.getByTestId("invoice-heading").innerText()).trim();
  expect(heading).toMatch(/^INV-\d{6}$/);
  return heading;
}

/** The order as the database holds it (status and version), read through the tenant's own client. */
export async function orderRow(tenant: TestTenant, orderId: string): Promise<{ status: string; version: number }> {
  const res = await tenant.client.rpc("order_get", { p_id: orderId });
  if (res.error || !res.data) throw new Error(`order_get: ${res.error?.message}`);
  return { status: res.data.status as string, version: res.data.version as number };
}

/** Changes the quantity of the first line of a confirmed order through the real order function. */
export async function editFirstLineQuantity(tenant: TestTenant, seed: InvoiceSeed, orderId: string, quantity: number): Promise<void> {
  const got = await tenant.client.rpc("order_get", { p_id: orderId });
  if (got.error || !got.data) throw new Error(`order_get: ${got.error?.message}`);
  const order = got.data as { version: number; lines: Array<{ id: string; product_id: string | null; quantity: number; unit: string }> };
  const lines = order.lines.map((l, i) => ({ id: l.id, product_id: l.product_id, name: null, quantity: i === 0 ? quantity : l.quantity, unit: l.unit }));
  const saved = await tenant.client.rpc("order_save", {
    p_id: orderId,
    p_request_id: randomUUID(),
    p_expected_version: order.version,
    p_store_id: seed.storeId,
    p_notes: null,
    p_lines: lines,
  });
  if (saved.error || !saved.data?.saved) throw new Error(`order_save: ${saved.error?.message ?? JSON.stringify(saved.data)}`);
}

export async function cancelOrder(tenant: TestTenant, orderId: string, reason = "Store changed its mind"): Promise<void> {
  const { version } = await orderRow(tenant, orderId);
  const res = await tenant.client.rpc("order_cancel", { p_id: orderId, p_request_id: randomUUID(), p_expected_version: version, p_reason: reason });
  if (res.error || !res.data?.cancelled) throw new Error(`order_cancel: ${res.error?.message ?? JSON.stringify(res.data)}`);
}

/** Saves the business phone, address and thermal paper width through the real settings function. */
export async function setBusinessDetails(tenant: TestTenant, details: { phone: string | null; address: string | null; thermalMm: number }): Promise<void> {
  const [settings, business] = await Promise.all([
    tenant.client.from("business_settings").select("version").maybeSingle(),
    tenant.client.from("businesses").select("name").maybeSingle(),
  ]);
  if (settings.error || business.error || !business.data) throw new Error("read settings failed");
  const res = await tenant.client.rpc("save_business_settings", {
    p_expected_version: settings.data?.version ?? 1,
    p_name: business.data.name,
    p_phone: details.phone,
    p_address: details.address,
    p_thermal_paper_mm: details.thermalMm,
    p_account_summary_default: false,
  });
  if (res.error || !res.data?.saved) throw new Error(`save_business_settings: ${res.error?.message ?? JSON.stringify(res.data)}`);
}

/** The words that must never appear in a printed invoice or order sheet. */
export const FORBIDDEN_PRINT_WORDS = ["90.00", "130.00", "purchase", "MRP", "cost", "margin", "profit"];

/** Creates the invoice of an order through the real functions: a draft, an issued invoice, or one issued and then cancelled. */
export async function makeInvoice(tenant: TestTenant, orderId: string, kind: "draft" | "issued" | "cancelled"): Promise<string> {
  const id = randomUUID();
  const created = await tenant.client.rpc("invoice_create", { p_id: id, p_order_id: orderId });
  if (created.error || !created.data?.done) throw new Error(`invoice_create: ${created.error?.message ?? JSON.stringify(created.data)}`);
  if (kind === "draft") return id;
  const issued = await tenant.client.rpc("invoice_issue", { p_id: id, p_expected_version: created.data.invoice.version });
  if (issued.error || !issued.data?.done) throw new Error(`invoice_issue: ${issued.error?.message ?? JSON.stringify(issued.data)}`);
  if (kind === "issued") return id;
  const cancelled = await tenant.client.rpc("invoice_cancel", { p_id: id, p_reason: "Wrong store" });
  if (cancelled.error || !cancelled.data?.done) throw new Error(`invoice_cancel: ${cancelled.error?.message ?? JSON.stringify(cancelled.data)}`);
  return id;
}
