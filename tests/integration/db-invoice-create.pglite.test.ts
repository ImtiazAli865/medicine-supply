import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanForbiddenKeys } from "../helpers/invoices";
import { createInvoiceDraft, dbInvoiceCreate, dbInvoiceGet, seedInvoiceOrder } from "../helpers/invoices-db";
import { catalogLine, typedLine } from "../helpers/orders";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// invoice_create on PGlite: one draft per confirmed order, priced only from the order line snapshot, retry-safe.

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

async function count(table: string, where = "true"): Promise<number> {
  const res = await db.query<{ n: number }>(`select count(*)::int as n from public.${table} where ${where}`);
  return res.rows[0].n;
}

describe("invoice_create", () => {
  it("creates one draft with one line per active order line and prices from the order snapshot", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const res = await dbInvoiceCreate(db, a.userId, seed.order.id);
    expect(res).toMatchObject({ done: true, created: true, replayed: false });
    const inv = res.invoice!;
    expect(inv).toMatchObject({ status: "draft", invoice_number: null, number_label: null, invoice_date: null, order_id: seed.order.id, stale: false, ready_to_issue: true, nothing_to_bill: false });
    expect(inv.order_number).toBe(seed.order.order.order_number);
    expect(inv.order_status).toBe("confirmed");
    expect(inv.lines.map((l) => [l.position, l.name, l.ordered_quantity, l.delivered_quantity, l.selling_price, l.line_total])).toEqual([
      [1, seed.names.priced, 10, 10, "125.50", "1255.00"],
      [2, seed.names.sellingOnly, 5, 5, "310.00", "1550.00"],
    ]);
    expect(inv.grand_total).toBe("2805.00");
    expect(inv.blockers).toEqual([]);
    expect(inv.lines.every((l) => l.billed && !l.needs_price && !l.typed && !l.more_than_ordered)).toBe(true);
    expect(inv.business.name).toBe("a business");
    expect(inv.store.id).toBe(seed.seeded.storeId);
    expect(inv.events?.map((e) => e.event_type)).toEqual(["created"]);
    expect(await count("invoices", `order_id = '${seed.order.id}'`)).toBe(1);
  });

  it("uses the order line's snapshot, never the current catalog price", async () => {
    const seed = await seedInvoiceOrder(db, a);
    await db.query(`update public.products set selling_price = '999.00' where id = $1`, [seed.seeded.pricedId]);
    const inv = await createInvoiceDraft(db, a.userId, seed.order.id);
    expect(inv.lines[0].selling_price).toBe("125.50");
    expect(inv.grand_total).toBe("2805.00");
  });

  it("does not copy lines that were removed from the order", async () => {
    const seed = await seedInvoiceOrder(db, a);
    await db.query(`update public.order_lines set removed_at = now() where id = $1`, [seed.order.lineIds[1]]);
    const inv = await createInvoiceDraft(db, a.userId, seed.order.id);
    expect(inv.lines).toHaveLength(1);
    expect(inv.grand_total).toBe("1255.00");
  });

  it("returns the stored draft when the same request is repeated, and never makes a second row", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const id = randomUUID();
    const first = await dbInvoiceCreate(db, a.userId, seed.order.id, id);
    const again = await dbInvoiceCreate(db, a.userId, seed.order.id, id);
    expect(first).toMatchObject({ done: true, created: true });
    expect(again).toMatchObject({ done: true, created: false, replayed: true });
    expect(again.invoice!.id).toBe(id);
    expect(await count("invoices", `order_id = '${seed.order.id}'`)).toBe(1);
    expect(await count("invoice_events", `invoice_id = '${id}'`)).toBe(1);
  });

  it("shows the existing live invoice for a different request id (another tap or device), never a second one", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const first = await createInvoiceDraft(db, a.userId, seed.order.id);
    const other = await dbInvoiceCreate(db, a.userId, seed.order.id, randomUUID());
    expect(other).toMatchObject({ done: true, created: false, existing: true });
    expect(other.invoice!.id).toBe(first.id);
    expect(await count("invoices", `order_id = '${seed.order.id}'`)).toBe(1);
  });

  it("refuses an invoice id that was already used for another order", async () => {
    const one = await seedInvoiceOrder(db, a);
    const two = await seedInvoiceOrder(db, a);
    const id = randomUUID();
    await dbInvoiceCreate(db, a.userId, one.order.id, id);
    expect(await dbInvoiceCreate(db, a.userId, two.order.id, id)).toMatchObject({ done: false, reason: "request_reused" });
    expect(await count("invoices", `order_id = '${two.order.id}'`)).toBe(0);
  });

  it("refuses a draft order, a cancelled order, an order without lines and an unknown order", async () => {
    const draft = await seedInvoiceOrder(db, a, { confirm: false });
    expect(await dbInvoiceCreate(db, a.userId, draft.order.id)).toMatchObject({ done: false, reason: "order_not_confirmed" });

    const cancelled = await seedInvoiceOrder(db, a);
    await db.query(`update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Test' where id = $1`, [cancelled.order.id]);
    expect(await dbInvoiceCreate(db, a.userId, cancelled.order.id)).toMatchObject({ done: false, reason: "order_not_confirmed" });

    const empty = await seedInvoiceOrder(db, a);
    await db.query(`update public.order_lines set removed_at = now() where order_id = $1`, [empty.order.id]);
    expect(await dbInvoiceCreate(db, a.userId, empty.order.id)).toMatchObject({ done: false, reason: "order_empty" });

    expect(await dbInvoiceCreate(db, a.userId, randomUUID())).toMatchObject({ done: false, reason: "not_found" });
    expect(await count("invoices", `order_id in ('${draft.order.id}', '${cancelled.order.id}', '${empty.order.id}')`)).toBe(0);
  });

  it("answers for another business's order exactly like a missing order", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const foreign = await dbInvoiceCreate(db, b.userId, seed.order.id);
    const missing = await dbInvoiceCreate(db, b.userId, randomUUID());
    expect(foreign).toEqual(missing);
    expect(foreign).toEqual({ done: false, reason: "not_found" });
    expect(await count("invoices", `order_id = '${seed.order.id}'`)).toBe(0);
  });

  it("lets two businesses use the same invoice id without colliding", async () => {
    const one = await seedInvoiceOrder(db, a);
    const two = await seedInvoiceOrder(db, b);
    const id = randomUUID();
    const first = await dbInvoiceCreate(db, a.userId, one.order.id, id);
    const second = await dbInvoiceCreate(db, b.userId, two.order.id, id);
    expect(first).toMatchObject({ done: true, created: true });
    expect(second).toMatchObject({ done: true, created: true });
    expect(second.invoice!.order_id).toBe(two.order.id);
    // Each business reads only its own invoice with that id.
    expect(await dbInvoiceGet(db, a.userId, id)).toMatchObject({ found: true, order_id: one.order.id });
    expect(await dbInvoiceGet(db, b.userId, id)).toMatchObject({ found: true, order_id: two.order.id });
  });

  it("copies a typed line with its text, marks it, and gives it no price", async () => {
    const seed = await seedInvoiceOrder(db, a, { lines: (s) => [catalogLine(s.pricedId, 2, "strip"), typedLine("Noran 20mg cap", 3, "strip")] });
    const inv = await createInvoiceDraft(db, a.userId, seed.order.id);
    const typed = inv.lines.find((l) => l.name === "Noran 20mg cap")!;
    expect(typed).toMatchObject({ typed: true, needs_price: true, selling_price: null, line_total: null, ordered_quantity: 3, delivered_quantity: 3, billed: true });
    expect(inv.blockers).toEqual([{ line_id: typed.id, name: "Noran 20mg cap", reason: "typed" }]);
    expect(inv.ready_to_issue).toBe(false);
    // The total covers only the priced line; the typed one is not guessed.
    expect(inv.grand_total).toBe("251.00");
  });

  it("marks a registered medicine without a price as needing one", async () => {
    const seed = await seedInvoiceOrder(db, a, { lines: (s) => [catalogLine(s.pricedId, 1, "strip"), catalogLine(s.noPriceId, 4, "bottle")] });
    const inv = await createInvoiceDraft(db, a.userId, seed.order.id);
    const unpriced = inv.lines.find((l) => l.name === seed.names.noPrice)!;
    expect(unpriced).toMatchObject({ typed: false, needs_price: true, selling_price: null, line_total: null });
    expect(inv.blockers).toEqual([{ line_id: unpriced.id, name: seed.names.noPrice, reason: "needs_price" }]);
  });

  it("never returns a purchase price, MRP, cost, margin or profit", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const res = await dbInvoiceCreate(db, a.userId, seed.order.id);
    expect(scanForbiddenKeys(res)).toEqual([]);
    expect(JSON.stringify(res)).not.toMatch(/90\.00|130\.00|200\.00|350\.00/);
    const got = await dbInvoiceGet(db, a.userId, res.invoice!.id);
    expect(scanForbiddenKeys(got)).toEqual([]);
  });
});
