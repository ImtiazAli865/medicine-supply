import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cancelInvoice,
  createInvoice,
  discardInvoice,
  getInvoice,
  getInvoiceSummary,
  getOrderSheet,
  issueInvoice,
  listInvoices,
  listToInvoice,
  refreshInvoice,
  updateQuantities,
} from "@/lib/invoices/repository";
import type { Invoice } from "@/lib/invoices/types";
import { InvoiceListQuerySchema, ToInvoiceQuerySchema } from "@/lib/validation/invoice";
import { scanForbiddenKeys, seedCatalogWithClient, seedConfirmedOrderOn, type ClientCatalog } from "../helpers/invoices";
import { getOrderWithClient, seedOrderWithClient } from "../helpers/pending";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// The invoice repository functions against the real Supabase test project: round trips of every write and read,
// replay, the totals rule on every returned line, and no cost anywhere. Needs migration 0007 on the test project.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const COST_VALUES = /(?<![\d.])(90|130|200|350)\.00(?!\d)/;

function expectClean(label: string, value: unknown): void {
  expect(scanForbiddenKeys(value), `${label}: forbidden key`).toEqual([]);
  expect(JSON.stringify(value), `${label}: cost value`).not.toMatch(COST_VALUES);
}

/** Every line total is delivered quantity x snapshot price, and the grand total is the sum of the billed ones. */
function expectTotals(invoice: Invoice): void {
  let sum = 0;
  for (const line of invoice.lines) {
    if (line.selling_price === null) {
      expect(line.line_total).toBeNull();
      continue;
    }
    const paisa = Math.round(Number(line.selling_price) * 100) * line.delivered_quantity;
    expect(Math.round(Number(line.line_total) * 100), `line ${line.position}`).toBe(paisa);
    if (line.delivered_quantity > 0) sum += paisa;
  }
  expect(Math.round(Number(invoice.grand_total) * 100)).toBe(sum);
}

suite("invoices through the repository (real Supabase test project)", () => {
  let a: TestTenant;
  let catalog: ClientCatalog;

  beforeAll(async () => {
    a = await createTenant("invoice-api");
    catalog = await seedCatalogWithClient(a.client, "Al Madina Medical");
  }, 120_000);

  afterAll(async () => {
    await deleteTenant(a);
  });

  it("creates a draft from a confirmed order, replays by id, and shows the existing one for another id", async () => {
    const order = await seedConfirmedOrderOn(a.client, catalog);
    const id = randomUUID();
    const first = await createInvoice(a.client, { id, order_id: order.orderId });
    expect(first).toMatchObject({ done: true, created: true });
    const inv = first.invoice;
    expect(inv).toMatchObject({ status: "draft", number_label: null, order_status: "confirmed", stale: false, ready_to_issue: true, grand_total: "2805.00" });
    expect(inv.lines.map((l) => [l.name, l.ordered_quantity, l.delivered_quantity, l.selling_price, l.line_total])).toEqual([
      [catalog.names.priced, 10, 10, "125.50", "1255.00"],
      [catalog.names.sellingOnly, 5, 5, "310.00", "1550.00"],
    ]);
    expectTotals(inv);
    expectClean("created", first);

    expect(await createInvoice(a.client, { id, order_id: order.orderId })).toMatchObject({ done: true, created: false, replayed: true });
    const other = await createInvoice(a.client, { id: randomUUID(), order_id: order.orderId });
    expect(other).toMatchObject({ done: true, created: false, existing: true });
    expect(other.invoice.id).toBe(id);
    expect((await getInvoice(a.client, id)).events).toHaveLength(1);
  }, 120_000);

  it("refuses a draft order and an unknown order with the documented errors", async () => {
    const draft = await seedOrderWithClient(a.client, catalog.storeId, [{ product_id: catalog.pricedId, quantity: 1 }], { confirm: false });
    await expect(createInvoice(a.client, { id: randomUUID(), order_id: draft.orderId })).rejects.toMatchObject({ code: "order_not_confirmed" });
    await expect(createInvoice(a.client, { id: randomUUID(), order_id: randomUUID() })).rejects.toMatchObject({ code: "not_found" });
  }, 120_000);

  it("changes delivered quantities, recalculates in SQL, and answers a stale version with the current invoice", async () => {
    const order = await seedConfirmedOrderOn(a.client, catalog);
    const { invoice } = await createInvoice(a.client, { id: randomUUID(), order_id: order.orderId });
    const saved = await updateQuantities(a.client, invoice.id, { expected_version: invoice.version, lines: [{ line_id: invoice.lines[0].id, delivered_quantity: 8 }] });
    expect(saved.invoice.lines[0]).toMatchObject({ ordered_quantity: 10, delivered_quantity: 8, line_total: "1004.00" });
    expect(saved.invoice.grand_total).toBe("2554.00");
    expectTotals(saved.invoice);

    await expect(updateQuantities(a.client, invoice.id, { expected_version: invoice.version, lines: [{ line_id: invoice.lines[0].id, delivered_quantity: 7 }] })).rejects.toMatchObject({
      code: "version_conflict",
      current: expect.objectContaining({ version: saved.invoice.version }),
    });
    await expect(updateQuantities(a.client, invoice.id, { expected_version: saved.invoice.version, lines: [{ line_id: invoice.lines[0].id, delivered_quantity: 100001 }] })).rejects.toMatchObject({ code: "validation_error" });
  }, 120_000);

  it("flags a stale draft after the order changes, and refresh rebuilds it", async () => {
    const order = await seedConfirmedOrderOn(a.client, catalog);
    const { invoice } = await createInvoice(a.client, { id: randomUUID(), order_id: order.orderId });
    const current = await getOrderWithClient(a.client, order.orderId);
    const edit = await a.client.rpc("order_save", {
      p_id: order.orderId,
      p_request_id: randomUUID(),
      p_expected_version: current.version,
      p_store_id: catalog.storeId,
      p_notes: null,
      p_lines: [
        { id: order.lineIds[0], product_id: catalog.pricedId, name: null, quantity: 12, unit: "strip" },
        { id: order.lineIds[1], product_id: catalog.sellingOnlyId, name: null, quantity: 5, unit: "box" },
      ],
    });
    expect(edit.data?.saved).toBe(true);

    const stale = await getInvoice(a.client, invoice.id);
    expect(stale).toMatchObject({ stale: true, ready_to_issue: false });
    await expect(issueInvoice(a.client, invoice.id, stale.version)).rejects.toMatchObject({ code: "order_changed" });

    const refreshed = await refreshInvoice(a.client, invoice.id, stale.version);
    expect(refreshed.invoice).toMatchObject({ stale: false, ready_to_issue: true });
    expect(refreshed.invoice.lines[0]).toMatchObject({ ordered_quantity: 12, delivered_quantity: 12 });
    expectTotals(refreshed.invoice);
  }, 120_000);

  it("discards a draft and keeps the order untouched", async () => {
    const order = await seedConfirmedOrderOn(a.client, catalog);
    const { invoice } = await createInvoice(a.client, { id: randomUUID(), order_id: order.orderId });
    expect(await discardInvoice(a.client, invoice.id, invoice.version)).toEqual({ done: true, order_id: order.orderId });
    await expect(getInvoice(a.client, invoice.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await getOrderWithClient(a.client, order.orderId)).status).toBe("confirmed");
  }, 120_000);

  it("issues with a number, fulfils the order, replays safely, and refuses an out-of-date version", async () => {
    const order = await seedConfirmedOrderOn(a.client, catalog);
    const { invoice } = await createInvoice(a.client, { id: randomUUID(), order_id: order.orderId });
    const edited = await updateQuantities(a.client, invoice.id, { expected_version: invoice.version, lines: [{ line_id: invoice.lines[1].id, delivered_quantity: 4 }] });
    await expect(issueInvoice(a.client, invoice.id, invoice.version)).rejects.toMatchObject({ code: "version_conflict" });

    const issued = await issueInvoice(a.client, invoice.id, edited.invoice.version);
    expect(issued).toMatchObject({ done: true, replayed: false });
    expect(issued.invoice).toMatchObject({ status: "issued", invoice_number: expect.any(Number), grand_total: "2495.00", order_status: "fulfilled" });
    expect(issued.invoice.number_label).toMatch(/^INV-\d{6}$/);
    expectTotals(issued.invoice);
    expectClean("issued", issued);

    const again = await issueInvoice(a.client, invoice.id, edited.invoice.version);
    expect(again).toMatchObject({ done: true, replayed: true });
    expect(again.invoice.invoice_number).toBe(issued.invoice.invoice_number);

    const fulfilled = await getOrderWithClient(a.client, order.orderId);
    expect(fulfilled.status).toBe("fulfilled");
    expect((fulfilled.lines as unknown as Array<{ quantity: number; delivered_quantity: number }>).map((l) => [l.quantity, l.delivered_quantity])).toEqual([[10, 10], [5, 4]]);
    expect(fulfilled.events.map((e) => e.event_type)).toContain("invoiced");
  }, 120_000);

  it("refuses issuing while a billed line has no verified price, with the blockers", async () => {
    const order = await seedConfirmedOrderOn(a.client, catalog, [
      { product_id: catalog.pricedId, quantity: 2 },
      { product_id: null, name: "Noran 20mg cap", quantity: 3 },
      { product_id: catalog.noPriceId, quantity: 1, unit: "bottle" },
    ]);
    const { invoice } = await createInvoice(a.client, { id: randomUUID(), order_id: order.orderId });
    await expect(issueInvoice(a.client, invoice.id, invoice.version)).rejects.toMatchObject({
      code: "not_ready",
      blockers: [expect.objectContaining({ name: "Noran 20mg cap", reason: "typed" }), expect.objectContaining({ name: catalog.names.noPrice, reason: "needs_price" })],
    });
    expect((await getInvoice(a.client, invoice.id)).status).toBe("draft");
  }, 120_000);

  it("cancels with a reason, returns the order to confirmed, keeps the number, and allows a replacement", async () => {
    const order = await seedConfirmedOrderOn(a.client, catalog);
    const { invoice } = await createInvoice(a.client, { id: randomUUID(), order_id: order.orderId });
    const issued = (await issueInvoice(a.client, invoice.id, invoice.version)).invoice;

    await expect(cancelInvoice(a.client, issued.id, "")).rejects.toMatchObject({ code: "reason_required" });
    const cancelled = await cancelInvoice(a.client, issued.id, "Wrong store");
    expect(cancelled).toMatchObject({ done: true, replayed: false });
    expect(cancelled.invoice).toMatchObject({ status: "cancelled", cancel_reason: "Wrong store", invoice_number: issued.invoice_number, order_status: "confirmed" });
    expect(cancelled.invoice.lines).toEqual(issued.lines);
    expectClean("cancelled", cancelled);

    const again = await cancelInvoice(a.client, issued.id, "Another reason");
    expect(again).toMatchObject({ done: true, replayed: true });
    expect(again.invoice.cancel_reason).toBe("Wrong store");

    const replacement = await createInvoice(a.client, { id: randomUUID(), order_id: order.orderId });
    expect(replacement).toMatchObject({ done: true, created: true });
    const next = (await issueInvoice(a.client, replacement.invoice.id, replacement.invoice.version)).invoice;
    expect(next.invoice_number).toBeGreaterThan(issued.invoice_number as number);
  }, 120_000);

  it("lists, filters and searches invoices, and the to-invoice count equals the to-invoice list", async () => {
    const issuedOrder = await seedConfirmedOrderOn(a.client, catalog);
    const created = await createInvoice(a.client, { id: randomUUID(), order_id: issuedOrder.orderId });
    const issued = (await issueInvoice(a.client, created.invoice.id, created.invoice.version)).invoice;
    const waiting = await seedConfirmedOrderOn(a.client, catalog);

    const all = await listInvoices(a.client, InvoiceListQuerySchema.parse({}));
    expect(all.total).toBeGreaterThan(0);
    expectClean("list", all);
    const byNumber = await listInvoices(a.client, InvoiceListQuerySchema.parse({ q: issued.number_label as string }));
    expect(byNumber.items.map((i) => i.id)).toEqual([issued.id]);
    const byStatus = await listInvoices(a.client, InvoiceListQuerySchema.parse({ status: "issued" }));
    expect(byStatus.items.every((i) => i.status === "issued")).toBe(true);
    const byOrder = await listInvoices(a.client, InvoiceListQuerySchema.parse({ order: issuedOrder.orderId }));
    expect(byOrder.items.map((i) => i.id)).toEqual([issued.id]);

    const todo = await listToInvoice(a.client, ToInvoiceQuerySchema.parse({ limit: "50" }));
    expect(todo.items.map((i) => i.order_id)).toContain(waiting.orderId);
    expect(todo.items.map((i) => i.order_id)).not.toContain(issuedOrder.orderId);
    const summary = await getInvoiceSummary(a.client);
    expect(summary.to_invoice).toBe(todo.total);
    expectClean("todo and summary", [todo, summary]);
  }, 180_000);

  it("returns order sheets without any price", async () => {
    const order = await seedConfirmedOrderOn(a.client, catalog);
    const sheet = await getOrderSheet(a.client, [order.orderId]);
    expect(sheet.sections).toHaveLength(1);
    expect(sheet.sections[0].lines.map((l) => [l.name, l.quantity, l.unit])).toEqual([
      [catalog.names.priced, 10, "strip"],
      [catalog.names.sellingOnly, 5, "box"],
    ]);
    expectClean("order sheet", sheet);
    expect(JSON.stringify(sheet)).not.toMatch(/price|125\.50|310\.00/i);
  }, 120_000);
});
