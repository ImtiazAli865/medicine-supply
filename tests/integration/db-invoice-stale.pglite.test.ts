import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createInvoiceDraft,
  dbInvoiceCancel,
  dbInvoiceCreate,
  dbInvoiceDiscard,
  dbInvoiceGet,
  dbInvoiceIssue,
  dbInvoiceRefresh,
  dbInvoiceSetQuantities,
  seedInvoiceOrder,
  type InvoiceSeed,
} from "../helpers/invoices-db";
import { catalogLine, savePayload, typedLine } from "../helpers/orders";
import { dbSave } from "../helpers/orders-db";
import { linkBody } from "../helpers/pending";
import { dbLink, dbPriceApplyRaw, refetch } from "../helpers/pending-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import type { Invoice } from "../../src/lib/invoices/types";

// A draft knows when its order changed (the fingerprint), refresh rebuilds it, and a discarded draft leaves the order alone.

let db: PGlite;
let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
  b = await createTenant(db, "b");
}, 60_000);

afterAll(async () => {
  await db.close();
});

async function isStale(invoiceId: string): Promise<boolean> {
  const got = await dbInvoiceGet(db, a.userId, invoiceId);
  if (!got.found) throw new Error("invoice not found");
  return got.stale;
}

/** Edits the confirmed order through the real order function (the lines given replace the order's lines). */
async function editOrder(seed: InvoiceSeed, lines: ReturnType<typeof catalogLine>[]): Promise<void> {
  const order = await refetch(db, a.userId, seed.order.id);
  const res = await dbSave(db, a.userId, seed.order.id, savePayload(seed.seeded.storeId, lines, { expected_version: order.version }));
  if (res.saved !== true) throw new Error(`edit refused: ${JSON.stringify(res)}`);
}

describe("stale detection", () => {
  it("is not stale right after creation", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const inv = await createInvoiceDraft(db, a.userId, seed.order.id);
    expect(inv.stale).toBe(false);
    expect(await isStale(inv.id)).toBe(false);
  });

  it("becomes stale when a line quantity changes on the order", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const inv = await createInvoiceDraft(db, a.userId, seed.order.id);
    const [first, second] = seed.order.order.lines;
    await editOrder(seed, [{ ...catalogLine(seed.seeded.pricedId, 12), id: first.id }, { ...catalogLine(seed.seeded.sellingOnlyId, 5, "box"), id: second.id }]);
    expect(await isStale(inv.id)).toBe(true);
  });

  it("becomes stale when a line is added or removed", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const inv = await createInvoiceDraft(db, a.userId, seed.order.id);
    const [first, second] = seed.order.order.lines;
    await editOrder(seed, [
      { ...catalogLine(seed.seeded.pricedId, 10), id: first.id },
      { ...catalogLine(seed.seeded.sellingOnlyId, 5, "box"), id: second.id },
      catalogLine(seed.seeded.noPriceId, 1, "bottle"),
    ]);
    expect(await isStale(inv.id)).toBe(true);

    const seed2 = await seedInvoiceOrder(db, a);
    const inv2 = await createInvoiceDraft(db, a.userId, seed2.order.id);
    await editOrder(seed2, [{ ...catalogLine(seed2.seeded.pricedId, 10), id: seed2.order.order.lines[0].id }]);
    expect(await isStale(inv2.id)).toBe(true);
  });

  it("becomes stale when a medicine is linked to a typed line", async () => {
    const seed = await seedInvoiceOrder(db, a, { lines: (s) => [catalogLine(s.pricedId, 2, "strip"), typedLine("Brufen typed", 3, "box")] });
    const inv = await createInvoiceDraft(db, a.userId, seed.order.id);
    expect(inv.ready_to_issue).toBe(false);
    const order = await refetch(db, a.userId, seed.order.id);
    const typed = order.lines.find((l) => l.product_id === null)!;
    const linked = await dbLink(db, a.userId, seed.order.id, typed.id, linkBody(order.version, seed.seeded.sellingOnlyId, { apply_price: true }));
    expect(linked.done ?? linked.ok).toBeTruthy();
    expect(await isStale(inv.id)).toBe(true);
  });

  it("becomes stale when Pending Prices fills a price on an order line", async () => {
    const seed = await seedInvoiceOrder(db, a, { lines: (s) => [catalogLine(s.pricedId, 1, "strip"), catalogLine(s.noPriceId, 4, "bottle")] });
    const inv = await createInvoiceDraft(db, a.userId, seed.order.id);
    expect(inv.blockers).toHaveLength(1);
    const order = await refetch(db, a.userId, seed.order.id);
    const waiting = order.lines.find((l) => l.product_id === seed.seeded.noPriceId)!;
    const filled = await dbPriceApplyRaw(db, a.userId, seed.seeded.noPriceId, "40.00", [waiting.id], true);
    expect(filled.done ?? filled.ok).toBeTruthy();
    expect(await isStale(inv.id)).toBe(true);

    // The stale draft cannot be issued; refresh rebuilds it with the new price and it becomes ready.
    expect(await dbInvoiceIssue(db, a.userId, inv.id, inv.version)).toMatchObject({ done: false, reason: "order_changed" });
    const refreshed = await dbInvoiceRefresh(db, a.userId, inv.id, inv.version);
    expect(refreshed.done).toBe(true);
    const next = refreshed.invoice!;
    expect(next).toMatchObject({ stale: false, ready_to_issue: true, blockers: [] });
    expect(next.lines.find((l) => l.name === seed.names.noPrice)).toMatchObject({ selling_price: "40.00", line_total: "160.00" });
    expect(next.grand_total).toBe("285.50");
  });
});

describe("invoice_refresh", () => {
  it("rebuilds the lines from the order, resets delivered quantities, clears stale and writes an event", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const inv = await createInvoiceDraft(db, a.userId, seed.order.id);
    const edited = await dbInvoiceSetQuantities(db, a.userId, inv.id, inv.version, [{ line_id: inv.lines[0].id, delivered_quantity: 3 }]);
    const [first, second] = seed.order.order.lines;
    await editOrder(seed, [{ ...catalogLine(seed.seeded.pricedId, 20), id: first.id }, { ...catalogLine(seed.seeded.sellingOnlyId, 5, "box"), id: second.id }]);
    const res = await dbInvoiceRefresh(db, a.userId, inv.id, edited.invoice!.version);
    expect(res.done).toBe(true);
    const next = res.invoice!;
    expect(next.stale).toBe(false);
    expect(next.lines.map((l) => [l.ordered_quantity, l.delivered_quantity])).toEqual([[20, 20], [5, 5]]);
    expect(next.grand_total).toBe("4060.00");
    expect(next.events![0].event_type).toBe("refreshed");
  });

  it("refuses an out-of-date version, an issued invoice and an order that is no longer confirmed", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const inv = await createInvoiceDraft(db, a.userId, seed.order.id);
    expect(await dbInvoiceRefresh(db, a.userId, inv.id, inv.version + 5)).toMatchObject({ done: false, reason: "version_conflict" });

    await db.query(`update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Test' where id = $1`, [seed.order.id]);
    expect(await dbInvoiceRefresh(db, a.userId, inv.id, inv.version)).toMatchObject({ done: false, reason: "order_not_confirmed" });

    const seed2 = await seedInvoiceOrder(db, a);
    const inv2 = await createInvoiceDraft(db, a.userId, seed2.order.id);
    const issued = await dbInvoiceIssue(db, a.userId, inv2.id, inv2.version);
    expect(await dbInvoiceRefresh(db, a.userId, inv2.id, issued.invoice!.version)).toMatchObject({ done: false, reason: "invoice_not_draft" });
  });

  it("refuses when the order has no active line left and leaves the draft as it was", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const inv = await createInvoiceDraft(db, a.userId, seed.order.id);
    await db.query(`update public.order_lines set removed_at = now() where order_id = $1`, [seed.order.id]);
    expect(await dbInvoiceRefresh(db, a.userId, inv.id, inv.version)).toMatchObject({ done: false, reason: "order_empty" });
    const got = (await dbInvoiceGet(db, a.userId, inv.id)) as Invoice & { found: true };
    expect(got.lines).toHaveLength(2);
  });

  it("answers for another business's invoice like a missing one", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const inv = await createInvoiceDraft(db, a.userId, seed.order.id);
    expect(await dbInvoiceRefresh(db, b.userId, inv.id, inv.version)).toEqual({ done: false, reason: "not_found" });
  });
});

describe("invoice_discard", () => {
  it("deletes the draft and its lines, keeps the history entry, and lets a new draft be created", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const inv = await createInvoiceDraft(db, a.userId, seed.order.id);
    const before = await refetch(db, a.userId, seed.order.id);
    const counterBefore = await db.query<{ last: number }>(`select coalesce(max(last_number), 0)::int as last from public.invoice_counters where business_id = $1`, [a.businessId]);
    const res = await dbInvoiceDiscard(db, a.userId, inv.id, inv.version);
    expect(res).toEqual({ done: true, order_id: seed.order.id });
    expect(await dbInvoiceGet(db, a.userId, inv.id)).toEqual({ found: false });
    const lines = await db.query<{ n: number }>(`select count(*)::int as n from public.invoice_lines where invoice_id = $1`, [inv.id]);
    expect(lines.rows[0].n).toBe(0);
    const events = await db.query<{ event_type: string }>(`select event_type from public.invoice_events where invoice_id = $1 order by created_at, id`, [inv.id]);
    expect(events.rows.map((r) => r.event_type)).toEqual(["created", "discarded"]);

    // The order is untouched, no invoice number was used, and a new draft can be made.
    const after = await refetch(db, a.userId, seed.order.id);
    expect(after).toEqual(before);
    const counterAfter = await db.query<{ last: number }>(`select coalesce(max(last_number), 0)::int as last from public.invoice_counters where business_id = $1`, [a.businessId]);
    expect(counterAfter.rows[0].last).toBe(counterBefore.rows[0].last);
    const again = await dbInvoiceCreate(db, a.userId, seed.order.id);
    expect(again).toMatchObject({ done: true, created: true });
  });

  it("refuses an out-of-date version and an issued invoice", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const inv = await createInvoiceDraft(db, a.userId, seed.order.id);
    expect(await dbInvoiceDiscard(db, a.userId, inv.id, inv.version + 3)).toMatchObject({ done: false, reason: "version_conflict" });
    const issued = await dbInvoiceIssue(db, a.userId, inv.id, inv.version);
    expect(await dbInvoiceDiscard(db, a.userId, inv.id, issued.invoice!.version)).toMatchObject({ done: false, reason: "invoice_not_draft" });
    expect(await dbInvoiceGet(db, a.userId, inv.id)).toMatchObject({ found: true, status: "issued" });
  });

  it("answers for another business's invoice like a missing one, and a second discard says not found", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const inv = await createInvoiceDraft(db, a.userId, seed.order.id);
    expect(await dbInvoiceDiscard(db, b.userId, inv.id, inv.version)).toEqual({ done: false, reason: "not_found" });
    await dbInvoiceDiscard(db, a.userId, inv.id, inv.version);
    expect(await dbInvoiceDiscard(db, a.userId, inv.id, inv.version)).toEqual({ done: false, reason: "not_found" });
  });
});

describe("a draft whose order was cancelled afterwards", () => {
  it("reports the order status, cannot be issued, and can be discarded", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const inv = await createInvoiceDraft(db, a.userId, seed.order.id);
    const order = await refetch(db, a.userId, seed.order.id);
    // The real order function: a confirmed order may be cancelled with a reason, even while a draft exists.
    const { dbCancel } = await import("../helpers/orders-db");
    const cancelled = await dbCancel(db, a.userId, seed.order.id, order.version, "Store changed its mind");
    expect(cancelled.cancelled).toBe(true);

    const got = (await dbInvoiceGet(db, a.userId, inv.id)) as Invoice & { found: true };
    expect(got).toMatchObject({ order_status: "cancelled", status: "draft", ready_to_issue: false });
    expect(await dbInvoiceIssue(db, a.userId, inv.id, got.version)).toMatchObject({ done: false, reason: "order_not_confirmed" });
    expect(await dbInvoiceCancel(db, a.userId, inv.id, "x")).toMatchObject({ done: false, reason: "invoice_not_issued" });
    expect(await dbInvoiceDiscard(db, a.userId, inv.id, got.version)).toMatchObject({ done: true });
    // A cancelled order cannot get a new draft.
    expect(await dbInvoiceCreate(db, a.userId, seed.order.id, randomUUID())).toMatchObject({ done: false, reason: "order_not_confirmed" });
  });
});
