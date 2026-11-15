import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createInvoiceDraft,
  dbInvoiceCreate,
  dbInvoiceGet,
  dbInvoiceIssue,
  dbInvoiceSetQuantities,
  seedInvoiceOrder,
  seedStoreAndMedicines,
} from "../helpers/invoices-db";
import { todayPkt } from "../helpers/market";
import { catalogLine, savePayload, typedLine } from "../helpers/orders";
import { dbCancel, dbSave } from "../helpers/orders-db";
import { createPendingOrder, refetch } from "../helpers/pending-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import type { Invoice } from "../../src/lib/invoices/types";

// invoice_issue on PGlite: the number, the frozen snapshot, the fulfilled order, every refusal.

let db: PGlite;
let seq = 0;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  await db.close();
});

/** A business of its own, so the invoice numbers of a test start at 1. */
async function fresh(): Promise<Tenant> {
  seq += 1;
  return createTenant(db, `issue-${seq}`);
}

async function counter(t: Tenant): Promise<number> {
  const res = await db.query<{ last: number }>(`select coalesce(max(last_number), 0)::int as last from public.invoice_counters where business_id = $1`, [t.businessId]);
  return res.rows[0].last;
}

describe("invoice_issue", () => {
  it("issues a ready draft with number 1, the Pakistan date, the user, and a frozen header", async () => {
    const t = await fresh();
    await db.query(`update public.business_settings set phone = '0300-1112223', address = 'Main Bazaar, Lahore' where business_id = $1`, [t.businessId]);
    const seed = await seedInvoiceOrder(db, t, { storeName: "Al Madina Medical" });
    await db.query(`update public.stores set contact_person = 'Mr Ali', phone = '042-111', address = 'Mall Road' where id = $1`, [seed.seeded.storeId]);
    const draft = await createInvoiceDraft(db, t.userId, seed.order.id);

    const res = await dbInvoiceIssue(db, t.userId, draft.id, draft.version);
    expect(res).toMatchObject({ done: true, replayed: false });
    const inv = res.invoice!;
    expect(inv).toMatchObject({ status: "issued", invoice_number: 1, number_label: "INV-000001", invoice_date: todayPkt(), issued_by_me: true, grand_total: "2805.00", ready_to_issue: false });
    expect(inv.issued_at).toBeTruthy();
    expect(inv.business).toEqual({ name: `issue-${seq} business`, phone: "0300-1112223", address: "Main Bazaar, Lahore" });
    expect(inv.store).toEqual({ id: seed.seeded.storeId, name: "Al Madina Medical", contact_person: "Mr Ali", phone: "042-111", address: "Mall Road" });
    expect(inv.events!.map((e) => e.event_type)).toEqual(["issued", "created"]);
    expect(await counter(t)).toBe(1);
  });

  it("gives 50 different, increasing numbers for 50 issues in a row", async () => {
    const t = await fresh();
    const { seeded } = await seedStoreAndMedicines(db, t.businessId);
    const numbers: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      const order = await createPendingOrder(db, t.userId, seeded.storeId, [catalogLine(seeded.pricedId, i + 1, "strip")], { confirm: true });
      const draft = await createInvoiceDraft(db, t.userId, order.id);
      const res = await dbInvoiceIssue(db, t.userId, draft.id, draft.version);
      numbers.push(res.invoice!.invoice_number!);
    }
    expect(numbers).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(await counter(t)).toBe(50);
  });

  it("counts numbers per business", async () => {
    const one = await fresh();
    const two = await fresh();
    const a = await seedInvoiceOrder(db, one);
    const b = await seedInvoiceOrder(db, two);
    const ia = await createInvoiceDraft(db, one.userId, a.order.id);
    const ib = await createInvoiceDraft(db, two.userId, b.order.id);
    expect((await dbInvoiceIssue(db, one.userId, ia.id, ia.version)).invoice!.invoice_number).toBe(1);
    expect((await dbInvoiceIssue(db, two.userId, ib.id, ib.version)).invoice!.invoice_number).toBe(1);
  });

  it("returns the same invoice on a repeat and uses no further number", async () => {
    const t = await fresh();
    const seed = await seedInvoiceOrder(db, t);
    const draft = await createInvoiceDraft(db, t.userId, seed.order.id);
    const first = await dbInvoiceIssue(db, t.userId, draft.id, draft.version);
    const again = await dbInvoiceIssue(db, t.userId, draft.id, draft.version);
    const lateVersion = await dbInvoiceIssue(db, t.userId, draft.id, null);
    expect(again).toMatchObject({ done: true, replayed: true });
    expect(lateVersion).toMatchObject({ done: true, replayed: true });
    expect(again.invoice).toEqual(first.invoice);
    expect(await counter(t)).toBe(1);
    const events = await db.query<{ n: number }>(`select count(*)::int as n from public.invoice_events where invoice_id = $1 and event_type = 'issued'`, [draft.id]);
    expect(events.rows[0].n).toBe(1);
  });

  it("refuses, with no number used and nothing changed, when a billed line has no verified price", async () => {
    const t = await fresh();
    const seed = await seedInvoiceOrder(db, t, { lines: (s) => [catalogLine(s.pricedId, 2, "strip"), typedLine("Noran 20mg cap", 3, "strip"), catalogLine(s.noPriceId, 1, "bottle")] });
    const draft = await createInvoiceDraft(db, t.userId, seed.order.id);
    const res = await dbInvoiceIssue(db, t.userId, draft.id, draft.version);
    expect(res).toMatchObject({ done: false, reason: "not_ready" });
    expect(res.blockers).toEqual([
      { line_id: draft.lines[1].id, name: "Noran 20mg cap", reason: "typed" },
      { line_id: draft.lines[2].id, name: seed.names.noPrice, reason: "needs_price" },
    ]);
    expect(await counter(t)).toBe(0);
    const after = (await dbInvoiceGet(db, t.userId, draft.id)) as Invoice & { found: true };
    expect(after).toMatchObject({ status: "draft", invoice_number: null, version: draft.version });
    expect(await refetch(db, t.userId, seed.order.id)).toMatchObject({ status: "confirmed" });
  });

  it("does not block on a typed or unpriced line whose delivered quantity is 0", async () => {
    const t = await fresh();
    const seed = await seedInvoiceOrder(db, t, { lines: (s) => [catalogLine(s.pricedId, 2, "strip"), typedLine("Noran 20mg cap", 3, "strip")] });
    const draft = await createInvoiceDraft(db, t.userId, seed.order.id);
    const typed = draft.lines.find((l) => l.typed)!;
    const zero = await dbInvoiceSetQuantities(db, t.userId, draft.id, draft.version, [{ line_id: typed.id, delivered_quantity: 0 }]);
    const issued = await dbInvoiceIssue(db, t.userId, draft.id, zero.invoice!.version);
    expect(issued).toMatchObject({ done: true, replayed: false });
    expect(issued.invoice!.grand_total).toBe("251.00");
    // The zero line is stored with the frozen invoice but is not billed.
    expect(issued.invoice!.lines.find((l) => l.typed)).toMatchObject({ delivered_quantity: 0, billed: false });
  });

  it("refuses when no line is billed", async () => {
    const t = await fresh();
    const seed = await seedInvoiceOrder(db, t);
    const draft = await createInvoiceDraft(db, t.userId, seed.order.id);
    const zero = await dbInvoiceSetQuantities(db, t.userId, draft.id, draft.version, draft.lines.map((l) => ({ line_id: l.id, delivered_quantity: 0 })));
    expect(zero.invoice).toMatchObject({ nothing_to_bill: true, ready_to_issue: false });
    expect(await dbInvoiceIssue(db, t.userId, draft.id, zero.invoice!.version)).toMatchObject({ done: false, reason: "nothing_to_bill" });
    expect(await counter(t)).toBe(0);
  });

  it("refuses a stale draft, a stale version and an order that is no longer confirmed", async () => {
    const t = await fresh();
    const seed = await seedInvoiceOrder(db, t);
    const draft = await createInvoiceDraft(db, t.userId, seed.order.id);
    expect(await dbInvoiceIssue(db, t.userId, draft.id, draft.version + 4)).toMatchObject({ done: false, reason: "version_conflict" });
    expect(await dbInvoiceIssue(db, t.userId, draft.id, null)).toMatchObject({ done: false, reason: "version_conflict" });

    const order = await refetch(db, t.userId, seed.order.id);
    const [first, second] = order.lines;
    const edit = await dbSave(db, t.userId, seed.order.id, savePayload(seed.seeded.storeId, [{ ...catalogLine(seed.seeded.pricedId, 11), id: first.id }, { ...catalogLine(seed.seeded.sellingOnlyId, 5, "box"), id: second.id }], { expected_version: order.version }));
    expect(edit.saved).toBe(true);
    expect(await dbInvoiceIssue(db, t.userId, draft.id, draft.version)).toMatchObject({ done: false, reason: "order_changed" });

    const seed2 = await seedInvoiceOrder(db, t);
    const draft2 = await createInvoiceDraft(db, t.userId, seed2.order.id);
    const o2 = await refetch(db, t.userId, seed2.order.id);
    await dbCancel(db, t.userId, seed2.order.id, o2.version, "Test");
    expect(await dbInvoiceIssue(db, t.userId, draft2.id, draft2.version)).toMatchObject({ done: false, reason: "order_not_confirmed" });
    expect(await counter(t)).toBe(0);
  });

  it("writes the delivered quantities to the order lines, fulfils the order and records both histories", async () => {
    const t = await fresh();
    const seed = await seedInvoiceOrder(db, t);
    const draft = await createInvoiceDraft(db, t.userId, seed.order.id);
    const edited = await dbInvoiceSetQuantities(db, t.userId, draft.id, draft.version, [{ line_id: draft.lines[0].id, delivered_quantity: 8 }, { line_id: draft.lines[1].id, delivered_quantity: 0 }]);
    const res = await dbInvoiceIssue(db, t.userId, draft.id, edited.invoice!.version);
    expect(res.invoice!.grand_total).toBe("1004.00");

    const order = await refetch(db, t.userId, seed.order.id);
    expect(order.status).toBe("fulfilled");
    expect(order.lines.map((l) => [l.quantity, l.delivered_quantity])).toEqual([[10, 8], [5, 0]]);
    const orderEvent = order.events!.find((e) => e.event_type === "invoiced")!;
    expect(orderEvent.detail).toMatchObject({
      invoiced: { invoice_id: draft.id, invoice_number: 1, number_label: "INV-000001", grand_total: "1004.00" },
    });
    const changes = (orderEvent.detail as { invoiced: { delivered_changes: Array<{ old: number; new: number }> } }).invoiced.delivered_changes;
    expect(changes.map((c) => [c.old, c.new])).toEqual([[10, 8], [5, 0]]);
    expect(res.invoice!.events![0].event_type).toBe("issued");
  });

  it("makes the order uneditable and uncancellable until the invoice is cancelled", async () => {
    const t = await fresh();
    const seed = await seedInvoiceOrder(db, t);
    const draft = await createInvoiceDraft(db, t.userId, seed.order.id);
    await dbInvoiceIssue(db, t.userId, draft.id, draft.version);
    const order = await refetch(db, t.userId, seed.order.id);
    const edit = await dbSave(db, t.userId, seed.order.id, savePayload(seed.seeded.storeId, [{ ...catalogLine(seed.seeded.pricedId, 1), id: order.lines[0].id }], { expected_version: order.version }));
    expect(edit).toMatchObject({ saved: false, reason: "order_not_editable" });
    expect(await dbCancel(db, t.userId, seed.order.id, order.version, "No")).toMatchObject({ cancelled: false, reason: "order_not_editable" });
    // A new draft cannot be made for a fulfilled order.
    expect(await dbInvoiceCreate(db, t.userId, seed.order.id, randomUUID())).toMatchObject({ done: false, reason: "order_not_confirmed" });
  });

  it("answers for another business's invoice exactly like a missing one", async () => {
    const t = await fresh();
    const other = await fresh();
    const seed = await seedInvoiceOrder(db, t);
    const draft = await createInvoiceDraft(db, t.userId, seed.order.id);
    const foreign = await dbInvoiceIssue(db, other.userId, draft.id, draft.version);
    const missing = await dbInvoiceIssue(db, other.userId, randomUUID(), 1);
    expect(foreign).toEqual(missing);
    expect(foreign).toEqual({ done: false, reason: "not_found" });
    expect(await counter(other)).toBe(0);
    expect(await counter(t)).toBe(0);
  });
});
