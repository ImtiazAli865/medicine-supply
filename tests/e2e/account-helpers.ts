import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { todayInPakistan } from "../../src/lib/orders/dates";
import { accountArgs, issueInvoiceWithClient, type IssuedWithClient } from "../helpers/accounts";
import type { TestTenant } from "../helpers/supabase-test";
import { expect } from "./fixtures";
import { seedStore } from "./orders-helpers";

// Shared set-up and steps for the Module 007 browser tests (store accounts, payments, the Account Summary,
// the statement). Every row is made through the real database functions with the tenant's own client.

export const TODAY = todayInPakistan();

/** A store of the tenant (a unique name keeps one business able to have many). */
export async function accountStore(tenant: TestTenant, name?: string): Promise<{ id: string; name: string }> {
  const storeName = name ?? `Nimer ${randomUUID().slice(0, 6)}`;
  return { id: await seedStore(tenant, storeName), name: storeName };
}

/** An opening balance through the real function. */
export async function addOpening(
  tenant: TestTenant,
  storeId: string,
  amount: string,
  direction: "owes" | "advance" = "owes",
  asOn = "2026-11-01",
  note: string | null = null,
): Promise<string> {
  const id = randomUUID();
  const res = await tenant.client.rpc("ledger_opening_add", accountArgs.opening(id, storeId, amount, direction, asOn, note));
  if (res.error || res.data?.done !== true) throw new Error(`ledger_opening_add: ${res.error?.message ?? JSON.stringify(res.data)}`);
  return id;
}

/** A payment through the real function. */
export async function addPayment(tenant: TestTenant, storeId: string, amount: string, date = TODAY, reference: string | null = null): Promise<string> {
  const id = randomUUID();
  const res = await tenant.client.rpc("ledger_payment_add", accountArgs.payment(id, storeId, amount, date, reference));
  if (res.error || res.data?.done !== true) throw new Error(`ledger_payment_add: ${res.error?.message ?? JSON.stringify(res.data)}`);
  return id;
}

/** An adjustment through the real function. */
export async function addAdjustment(
  tenant: TestTenant,
  storeId: string,
  amount: string,
  direction: "reduce" | "increase",
  reason: string,
): Promise<string> {
  const id = randomUUID();
  const res = await tenant.client.rpc("ledger_adjustment_add", accountArgs.adjustment(id, storeId, amount, direction, reason));
  if (res.error || res.data?.done !== true) throw new Error(`ledger_adjustment_add: ${res.error?.message ?? JSON.stringify(res.data)}`);
  return id;
}

/** An issued invoice of exactly `total` (one line of a new medicine), optionally with a payment received now. */
export async function issueFor(tenant: TestTenant, storeId: string, total: string, payment: string | null = null): Promise<IssuedWithClient> {
  return issueInvoiceWithClient(tenant.client, storeId, total, { payment });
}

/** Cancels an issued invoice through the real function. */
export async function cancelIssued(tenant: TestTenant, invoiceId: string, reason = "Wrong quantities"): Promise<void> {
  const res = await tenant.client.rpc("invoice_cancel", { p_id: invoiceId, p_reason: reason });
  if (res.error || res.data?.done !== true) throw new Error(`invoice_cancel: ${res.error?.message ?? JSON.stringify(res.data)}`);
}

/** The signed balance of a store as the database computes it, as text. */
export async function balanceOfStore(tenant: TestTenant, storeId: string): Promise<string> {
  const res = await tenant.client.rpc("ledger_account", { p_store: storeId, p_limit: 1, p_offset: 0 });
  if (res.error || res.data?.found !== true) throw new Error(`ledger_account: ${res.error?.message ?? JSON.stringify(res.data)}`);
  return res.data.balance as string;
}

/** Opens the account screen of a store and waits for the balance card. */
export async function openAccount(page: Page, storeId: string): Promise<void> {
  await page.goto(`/accounts/${storeId}`);
  await expect(page.getByTestId("account-balance-card")).toBeVisible({ timeout: 15_000 });
}
