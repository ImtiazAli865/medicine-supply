import type { TestTenant } from "../helpers/supabase-test";
import { recordArgs, recordBody } from "../helpers/market";
import { expect } from "./fixtures";
import { confirmedOrder, makeInvoice, seedInvoiceWorld, type InvoiceSeed } from "./invoice-helpers";
import { createOrder } from "./orders-helpers";
import { todayInPakistan } from "./market-helpers";

// Shared set-up for the Module 010 browser tests. The app dates an invoice with today's Pakistan day, so these tests use
// today; the day-by-day rules (the owner's 50/55 and 58/65 example, other days' purchases) are tested on PGlite where a
// date can be set.

export interface ReportWorld extends InvoiceSeed {
  today: string;
}

/**
 * One store and three medicines. Today: 10 Panadol bought at an actual 80.00; one issued invoice for 10 Panadol (at
 * 125.50, saved purchase price 90.00) and 5 Brufen (at 310.00, no saved purchase price and no purchase today); a second
 * invoice that was cancelled; and a draft invoice.
 *
 * Expected: sales PKR 2,805.00 (1 invoice). Realized: cost 800.00, profit 455.00 over Panadol, Brufen has no cost
 * (1 line, PKR 1,550.00): Incomplete. Estimated: cost 900.00, profit 355.00 over Panadol, Brufen has no saved price:
 * Incomplete. Left out: 1 cancelled invoice and 1 draft invoice.
 */
export async function seedReportWorld(tenant: TestTenant): Promise<ReportWorld> {
  const seed = await seedInvoiceWorld(tenant);
  const today = todayInPakistan();
  const bought = await tenant.client.rpc("purchase_record", recordArgs(recordBody(seed.pricedId, today, 10, { unit_cost: "80.00" })));
  expect(bought.data).toMatchObject({ done: true });

  const main = await confirmedOrder(tenant, seed);
  await makeInvoice(tenant, main.id, "issued");

  const second = await createOrder(tenant, seed.storeId, [{ product_id: seed.pricedId, quantity: 1, unit: "strip" }], { confirm: true });
  await makeInvoice(tenant, second.id, "cancelled");

  const third = await createOrder(tenant, seed.storeId, [{ product_id: seed.pricedId, quantity: 2, unit: "strip" }], { confirm: true });
  await makeInvoice(tenant, third.id, "draft");
  return { ...seed, today };
}

/** The words a store must never see: nothing about cost or profit is allowed on any customer-facing page. */
export const REPORT_WORDS = ["Realized profit", "Estimated profit", "Cost missing"];
