import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createInvoiceDraft,
  dbInvoiceCancel,
  dbInvoiceCreate,
  dbInvoiceGet,
  dbInvoiceIssue,
  dbInvoiceSetQuantities,
  dbInvoicesOfOrder,
  issueInvoice,
  seedInvoiceOrder,
} from "../helpers/invoices-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import { refetch } from "../helpers/pending-db";
import type { Invoice } from "../../src/lib/invoices/types";

// invoice_cancel on PGlite: a reason is required, the number and lines stay, the order returns to confirmed.

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
  return createTenant(db, `cancel-${seq}`);
}

async function issuedInvoice(t: Tenant, delivered?: number) {
  const seed = await seedInvoiceOrder(db, t);
  let draft = await createInvoiceDraft(db, t.userId, seed.order.id);
  if (delivered !== undefined) {
    const res = await dbInvoiceSetQuantities(db, t.userId, draft.id, draft.version, [{ line_id: draft.lines[0].id, delivered_quantity: delivered }]);
    draft = res.invoice!;
  }
  return { seed, inv: await issueInvoice(db, t.userId, draft) };
}

describe("invoice_cancel", () => {
  it("cancels with a reason, keeps the number, lines and totals, and records who, when and why", async () => {
    const t = await fresh();
    const { inv } = await issuedInvoice(t);
    const res = await dbInvoiceCancel(db, t.userId, inv.id, "  Wrong store  ");
    expect(res).toMatchObject({ done: true, replayed: false });
    const next = res.invoice!;
    expect(next).toMatchObject({ status: "cancelled", cancel_reason: "Wrong store", invoice_number: 1, number_label: "INV-000001", grand_total: "2805.00", order_status: "confirmed" });
    expect(next.cancelled_at).toBeTruthy();
    expect(next.lines).toEqual(inv.lines);
    expect(next.business).toEqual(inv.business);
    expect(next.store).toEqual(inv.store);
    expect(next.events![0]).toMatchObject({ event_type: "cancelled", mine: true, detail: { cancelled: { reason: "Wrong store", number_label: "INV-000001" } } });
  });

  it.each([
    ["an empty reason", ""],
    ["spaces only", "    "],
    ["no reason", null],
  ])("refuses %s and changes nothing", async (_label, reason) => {
    const t = await fresh();
    const { seed, inv } = await issuedInvoice(t);
    expect(await dbInvoiceCancel(db, t.userId, inv.id, reason)).toMatchObject({ done: false, reason: "reason_required" });
    expect(await dbInvoiceGet(db, t.userId, inv.id)).toMatchObject({ found: true, status: "issued" });
    expect((await refetch(db, t.userId, seed.order.id)).status).toBe("fulfilled");
  });

  it("accepts a reason of 500 characters and refuses 501", async () => {
    const t = await fresh();
    const { inv } = await issuedInvoice(t);
    expect(await dbInvoiceCancel(db, t.userId, inv.id, "x".repeat(501))).toMatchObject({ done: false, reason: "reason_too_long" });
    expect(await dbInvoiceCancel(db, t.userId, inv.id, "x".repeat(500))).toMatchObject({ done: true });
  });

  it("returns the order to confirmed and the delivered quantities to the ordered ones, and the invoice keeps what was billed", async () => {
    const t = await fresh();
    const { seed, inv } = await issuedInvoice(t, 8);
    const fulfilled = await refetch(db, t.userId, seed.order.id);
    expect(fulfilled.lines.map((l) => l.delivered_quantity)).toEqual([8, 5]);

    const res = await dbInvoiceCancel(db, t.userId, inv.id, "Wrong quantity");
    const order = await refetch(db, t.userId, seed.order.id);
    expect(order.status).toBe("confirmed");
    expect(order.lines.map((l) => [l.quantity, l.delivered_quantity])).toEqual([[10, 10], [5, 5]]);
    expect(res.invoice!.lines.map((l) => l.delivered_quantity)).toEqual([8, 5]);
    expect(res.invoice!.grand_total).toBe("2554.00");

    const event = order.events!.find((e) => e.event_type === "invoice_cancelled")!;
    expect(event.detail).toMatchObject({ invoice_cancelled: { invoice_id: inv.id, number_label: "INV-000001", reason: "Wrong quantity" } });
    const reset = (event.detail as { invoice_cancelled: { delivered_reset: Array<{ old: number; new: number }> } }).invoice_cancelled.delivered_reset;
    expect(reset.map((c) => [c.old, c.new])).toEqual([[8, 10]]);
  });

  it("returns the first cancellation on a repeat and keeps the first reason", async () => {
    const t = await fresh();
    const { inv } = await issuedInvoice(t);
    const first = await dbInvoiceCancel(db, t.userId, inv.id, "First reason");
    const again = await dbInvoiceCancel(db, t.userId, inv.id, "Second reason");
    expect(again).toMatchObject({ done: true, replayed: true });
    expect(again.invoice).toEqual(first.invoice);
    expect(again.invoice!.cancel_reason).toBe("First reason");
    const events = await db.query<{ n: number }>(`select count(*)::int as n from public.invoice_events where invoice_id = $1 and event_type = 'cancelled'`, [inv.id]);
    expect(events.rows[0].n).toBe(1);
    // A repeat even without a reason is a replay, not an error.
    expect(await dbInvoiceCancel(db, t.userId, inv.id, null)).toMatchObject({ done: true, replayed: true });
  });

  it("cannot cancel a draft, and cannot issue a cancelled invoice again", async () => {
    const t = await fresh();
    const seed = await seedInvoiceOrder(db, t);
    const draft = await createInvoiceDraft(db, t.userId, seed.order.id);
    expect(await dbInvoiceCancel(db, t.userId, draft.id, "x")).toMatchObject({ done: false, reason: "invoice_not_issued" });

    const { inv } = await issuedInvoice(t);
    await dbInvoiceCancel(db, t.userId, inv.id, "Wrong");
    expect(await dbInvoiceIssue(db, t.userId, inv.id, inv.version)).toMatchObject({ done: false, reason: "invoice_not_draft" });
  });

  it("lets a replacement be created and issued with the next number; the cancelled number is never reused", async () => {
    const t = await fresh();
    const { seed, inv } = await issuedInvoice(t);
    await dbInvoiceCancel(db, t.userId, inv.id, "Wrong store");

    const replacement = await dbInvoiceCreate(db, t.userId, seed.order.id, randomUUID());
    expect(replacement).toMatchObject({ done: true, created: true });
    const draft = replacement.invoice!;
    expect(draft.id).not.toBe(inv.id);
    // The replacement starts again from the ordered quantities.
    expect(draft.lines.map((l) => [l.ordered_quantity, l.delivered_quantity])).toEqual([[10, 10], [5, 5]]);
    const issued = await issueInvoice(db, t.userId, draft);
    expect(issued).toMatchObject({ status: "issued", invoice_number: 2, number_label: "INV-000002" });

    const summary = (await dbInvoicesOfOrder(db, t.userId, seed.order.id)) as Array<{ id: string; status: string; number_label: string | null }>;
    expect(summary.map((s) => [s.number_label, s.status])).toEqual([["INV-000002", "issued"], ["INV-000001", "cancelled"]]);
  });

  it("answers for another business's invoice exactly like a missing one", async () => {
    const t = await fresh();
    const other = await fresh();
    const { inv } = await issuedInvoice(t);
    const foreign = await dbInvoiceCancel(db, other.userId, inv.id, "x");
    expect(foreign).toEqual(await dbInvoiceCancel(db, other.userId, randomUUID(), "x"));
    expect(foreign).toEqual({ done: false, reason: "not_found" });
    expect((await dbInvoiceGet(db, t.userId, inv.id)) as Invoice & { found: true }).toMatchObject({ status: "issued" });
  });
});
