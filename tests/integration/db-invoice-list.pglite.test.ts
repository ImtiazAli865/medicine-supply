import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createInvoiceDraft,
  dbInvoiceCancel,
  dbInvoiceList,
  dbInvoiceSummary,
  dbInvoiceTodo,
  issueInvoice,
  seedInvoiceOrder,
} from "../helpers/invoices-db";
import { addDays, todayPkt } from "../helpers/market-db";
import { catalogLine } from "../helpers/orders";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import { dbCancel } from "../helpers/orders-db";
import { refetch } from "../helpers/pending-db";

// invoice_list, invoice_todo and invoice_summary on PGlite: filters, search, paging and the shared "to invoice" definition.

let db: PGlite;
let seq = 0;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  await db.close();
});

async function fresh(): Promise<Tenant> {
  seq += 1;
  return createTenant(db, `list-${seq}`);
}

/** Three stores: one draft, one issued, one issued then cancelled. */
async function setUp(t: Tenant) {
  const madina = await seedInvoiceOrder(db, t, { storeName: "Al Madina Medical" });
  const shah = await seedInvoiceOrder(db, t, { storeName: "Shah Medical" });
  const rehman = await seedInvoiceOrder(db, t, { storeName: "Rehman 100% Pharma_1" });
  const draft = await createInvoiceDraft(db, t.userId, madina.order.id);
  const issued = await issueInvoice(db, t.userId, await createInvoiceDraft(db, t.userId, shah.order.id));
  const toCancel = await issueInvoice(db, t.userId, await createInvoiceDraft(db, t.userId, rehman.order.id));
  const cancelled = (await dbInvoiceCancel(db, t.userId, toCancel.id, "Wrong store")).invoice!;
  return { madina, shah, rehman, draft, issued, cancelled };
}

describe("invoice_list", () => {
  it("lists newest first with number, store, date, total and status", async () => {
    const t = await fresh();
    const s = await setUp(t);
    const page = await dbInvoiceList(db, t.userId);
    expect(page.total).toBe(3);
    expect(page.items.map((i) => i.id)).toEqual([s.cancelled.id, s.issued.id, s.draft.id]);
    // Newest created first: the draft was created first, then the issued one, then the cancelled one.
    expect(page.items.map((i) => [i.number_label, i.status, i.store_name, i.grand_total])).toEqual([
      ["INV-000002", "cancelled", "Rehman 100% Pharma_1", "2805.00"],
      ["INV-000001", "issued", "Shah Medical", "2805.00"],
      [null, "draft", "Al Madina Medical", "2805.00"],
    ]);
    expect(page.items[2]).toMatchObject({ invoice_date: null, order_id: s.madina.order.id, order_number: s.madina.order.order.order_number });
    expect(page.items[1].invoice_date).toBe(todayPkt());
  });

  it("filters by status, store, order and date range (invoice date, or the creation day for a draft)", async () => {
    const t = await fresh();
    const s = await setUp(t);
    expect((await dbInvoiceList(db, t.userId, { status: "draft" })).items.map((i) => i.id)).toEqual([s.draft.id]);
    expect((await dbInvoiceList(db, t.userId, { status: "issued" })).items.map((i) => i.id)).toEqual([s.issued.id]);
    expect((await dbInvoiceList(db, t.userId, { status: "cancelled" })).items.map((i) => i.id)).toEqual([s.cancelled.id]);
    expect((await dbInvoiceList(db, t.userId, { status: "all" })).total).toBe(3);
    expect((await dbInvoiceList(db, t.userId, { store: s.shah.seeded.storeId })).items.map((i) => i.id)).toEqual([s.issued.id]);
    expect((await dbInvoiceList(db, t.userId, { order: s.rehman.order.id })).items.map((i) => i.id)).toEqual([s.cancelled.id]);

    const today = todayPkt();
    expect((await dbInvoiceList(db, t.userId, { from: today, to: today })).total).toBe(3);
    expect((await dbInvoiceList(db, t.userId, { from: addDays(today, 1) })).total).toBe(0);
    expect((await dbInvoiceList(db, t.userId, { to: addDays(today, -1) })).total).toBe(0);
    expect((await dbInvoiceList(db, t.userId, { from: today, status: "draft" })).total).toBe(1);
  });

  it("searches by invoice number and by store name, treating % and _ literally", async () => {
    const t = await fresh();
    const s = await setUp(t);
    const ids = async (q: string) => (await dbInvoiceList(db, t.userId, { q })).items.map((i) => i.id);
    expect(await ids("INV-000001")).toEqual([s.issued.id]);
    expect(await ids("inv-2")).toEqual([s.cancelled.id]);
    expect(await ids("2")).toContain(s.cancelled.id);
    expect(await ids("madina")).toEqual([s.draft.id]);
    expect(await ids("shah med")).toEqual([s.issued.id]);
    expect(await ids("%")).toEqual([s.cancelled.id]);
    expect(await ids("_1")).toEqual([s.cancelled.id]);
    expect(await ids("nothing like this")).toEqual([]);
    expect(await ids("   ")).toHaveLength(3);
  });

  it("pages with a limit and an offset, caps the page, and gives the total", async () => {
    const t = await fresh();
    await setUp(t);
    const first = await dbInvoiceList(db, t.userId, { limit: 2, offset: 0 });
    const second = await dbInvoiceList(db, t.userId, { limit: 2, offset: 2 });
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    expect(first.total).toBe(3);
    expect(second.total).toBe(3);
    expect(new Set([...first.items, ...second.items].map((i) => i.id)).size).toBe(3);
    expect((await dbInvoiceList(db, t.userId, { limit: 1000 })).items).toHaveLength(3);
    expect((await dbInvoiceList(db, t.userId, { limit: 0 })).items).toHaveLength(1);
  });

  it("never lists another business's invoices", async () => {
    const t = await fresh();
    const other = await fresh();
    await setUp(t);
    expect(await dbInvoiceList(db, other.userId)).toEqual({ items: [], total: 0 });
  });
});

describe("invoice_todo and invoice_summary share one definition", () => {
  it("list the confirmed orders without an issued invoice, and nothing else", async () => {
    const t = await fresh();
    const plain = await seedInvoiceOrder(db, t, { storeName: "Plain" });
    const withDraft = await seedInvoiceOrder(db, t, { storeName: "With draft" });
    const fulfilled = await seedInvoiceOrder(db, t, { storeName: "Fulfilled" });
    const draftOrder = await seedInvoiceOrder(db, t, { storeName: "Draft order", confirm: false });
    const cancelledOrder = await seedInvoiceOrder(db, t, { storeName: "Cancelled order" });
    const emptied = await seedInvoiceOrder(db, t, { storeName: "Emptied order" });

    const draft = await createInvoiceDraft(db, t.userId, withDraft.order.id);
    await issueInvoice(db, t.userId, await createInvoiceDraft(db, t.userId, fulfilled.order.id));
    const co = await refetch(db, t.userId, cancelledOrder.order.id);
    await dbCancel(db, t.userId, cancelledOrder.order.id, co.version, "Test");
    await db.query(`update public.order_lines set removed_at = now() where order_id = $1`, [emptied.order.id]);

    const todo = await dbInvoiceTodo(db, t.userId);
    const byStore = Object.fromEntries(todo.items.map((i) => [i.store_name, i]));
    expect(Object.keys(byStore).sort()).toEqual(["Plain", "With draft"]);
    expect(byStore.Plain).toMatchObject({ order_id: plain.order.id, line_count: 2, lines_without_price: 0, draft_invoice_id: null });
    expect(byStore["With draft"]).toMatchObject({ order_id: withDraft.order.id, draft_invoice_id: draft.id });
    expect(todo.total).toBe(2);
    void draftOrder;

    const summary = await dbInvoiceSummary(db, t.userId);
    expect(summary.to_invoice).toBe(todo.total);
    expect(summary).toMatchObject({ drafts: 1, issued_today: 1 });
  });

  it("count lines without a verified price, and an order returns to the list when its invoice is cancelled", async () => {
    const t = await fresh();
    const seed = await seedInvoiceOrder(db, t, { lines: (s) => [catalogLine(s.pricedId, 1, "strip"), catalogLine(s.noPriceId, 2, "bottle")] });
    expect((await dbInvoiceTodo(db, t.userId)).items[0]).toMatchObject({ order_id: seed.order.id, line_count: 2, lines_without_price: 1 });

    const ok = await seedInvoiceOrder(db, t);
    const issued = await issueInvoice(db, t.userId, await createInvoiceDraft(db, t.userId, ok.order.id));
    expect((await dbInvoiceTodo(db, t.userId)).items.map((i) => i.order_id)).toEqual([seed.order.id]);
    await dbInvoiceCancel(db, t.userId, issued.id, "Wrong");
    const after = await dbInvoiceTodo(db, t.userId);
    expect(after.items.map((i) => i.order_id).sort()).toEqual([seed.order.id, ok.order.id].sort());
    expect((await dbInvoiceSummary(db, t.userId)).to_invoice).toBe(after.total);
  });

  it("search the to-invoice list by store name or order number, and never show another business's orders", async () => {
    const t = await fresh();
    const other = await fresh();
    const a = await seedInvoiceOrder(db, t, { storeName: "Al Madina Medical" });
    await seedInvoiceOrder(db, t, { storeName: "Shah Medical" });
    await seedInvoiceOrder(db, other, { storeName: "Foreign Store" });
    expect((await dbInvoiceTodo(db, t.userId, "madina")).items.map((i) => i.order_id)).toEqual([a.order.id]);
    expect((await dbInvoiceTodo(db, t.userId, String(a.order.order.order_number))).items.map((i) => i.order_id)).toContain(a.order.id);
    expect((await dbInvoiceTodo(db, t.userId)).total).toBe(2);
    expect((await dbInvoiceTodo(db, t.userId, "foreign")).total).toBe(0);
    expect(await dbInvoiceTodo(db, randomUUID())).toEqual({ items: [], total: 0 });
  });
});
