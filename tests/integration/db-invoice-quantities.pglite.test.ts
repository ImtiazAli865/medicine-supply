import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInvoiceDraft, dbInvoiceGet, dbInvoiceIssue, dbInvoiceSetQuantities, issueInvoice, seedInvoiceOrder, type InvoiceSeed } from "../helpers/invoices-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import type { Invoice } from "../../src/lib/invoices/types";

// invoice_set_quantities on PGlite: the delivered (billed) quantity of draft lines, the totals in SQL, the version.

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

async function draft(): Promise<{ seed: InvoiceSeed; inv: Invoice }> {
  const seed = await seedInvoiceOrder(db, a);
  return { seed, inv: await createInvoiceDraft(db, a.userId, seed.order.id) };
}

describe("invoice_set_quantities", () => {
  it("changes only the chosen line and recomputes the totals, leaving the ordered quantity alone", async () => {
    const { inv } = await draft();
    const res = await dbInvoiceSetQuantities(db, a.userId, inv.id, inv.version, [{ line_id: inv.lines[0].id, delivered_quantity: 8 }]);
    expect(res.done).toBe(true);
    const next = res.invoice!;
    expect(next.lines[0]).toMatchObject({ ordered_quantity: 10, delivered_quantity: 8, line_total: "1004.00", more_than_ordered: false });
    expect(next.lines[1]).toMatchObject({ ordered_quantity: 5, delivered_quantity: 5, line_total: "1550.00" });
    expect(next.grand_total).toBe("2554.00");
    expect(next.version).toBeGreaterThan(inv.version);
  });

  it("accepts 0 (not billed), a quantity above the ordered one (flagged) and the maximum", async () => {
    const { inv } = await draft();
    const zero = await dbInvoiceSetQuantities(db, a.userId, inv.id, inv.version, [{ line_id: inv.lines[0].id, delivered_quantity: 0 }]);
    expect(zero.invoice!.lines[0]).toMatchObject({ delivered_quantity: 0, billed: false, needs_price: false, line_total: "0.00" });
    expect(zero.invoice!.grand_total).toBe("1550.00");

    const more = await dbInvoiceSetQuantities(db, a.userId, inv.id, zero.invoice!.version, [{ line_id: inv.lines[0].id, delivered_quantity: 12 }]);
    expect(more.invoice!.lines[0]).toMatchObject({ delivered_quantity: 12, more_than_ordered: true, line_total: "1506.00" });

    const max = await dbInvoiceSetQuantities(db, a.userId, inv.id, more.invoice!.version, [{ line_id: inv.lines[1].id, delivered_quantity: 100000 }]);
    expect(max.invoice!.lines[1].delivered_quantity).toBe(100000);
    expect(max.invoice!.lines[1].line_total).toBe("31000000.00");
  });

  it.each([
    ["-1", -1],
    ["100001", 100001],
    ["a fraction", 1.5],
    ["a string", "8"],
    ["null", null],
  ])("refuses %s and names the field", async (_label, quantity) => {
    const { inv } = await draft();
    const res = await dbInvoiceSetQuantities(db, a.userId, inv.id, inv.version, [{ line_id: inv.lines[0].id, delivered_quantity: quantity }]);
    expect(res).toMatchObject({ done: false, reason: "invalid_quantity", line_id: inv.lines[0].id });
    expect(res.fields?.delivered_quantity).toBeTruthy();
    const unchanged = await dbInvoiceGet(db, a.userId, inv.id);
    expect(unchanged).toMatchObject({ found: true, version: inv.version, grand_total: "2805.00" });
  });

  it("refuses a bad list: empty, too long, a line listed twice, a line id that is not a UUID, a foreign line", async () => {
    const { inv } = await draft();
    const bad = async (lines: unknown[]) => dbInvoiceSetQuantities(db, a.userId, inv.id, inv.version, lines as Array<{ line_id: string; delivered_quantity: unknown }>);
    expect(await bad([])).toMatchObject({ done: false, reason: "invalid_quantity" });
    expect(await bad(Array.from({ length: 201 }, () => ({ line_id: inv.lines[0].id, delivered_quantity: 1 })))).toMatchObject({ done: false, reason: "invalid_quantity" });
    expect(await bad([{ line_id: inv.lines[0].id, delivered_quantity: 1 }, { line_id: inv.lines[0].id, delivered_quantity: 2 }])).toMatchObject({ done: false, reason: "invalid_quantity" });
    expect(await bad([{ line_id: "nope", delivered_quantity: 1 }])).toMatchObject({ done: false, reason: "invalid_quantity" });
    expect(await bad([{ line_id: randomUUID(), delivered_quantity: 1 }])).toMatchObject({ done: false, reason: "line_not_found" });
  });

  it("refuses a stale version with the current invoice, and a missing version", async () => {
    const { inv } = await draft();
    const first = await dbInvoiceSetQuantities(db, a.userId, inv.id, inv.version, [{ line_id: inv.lines[0].id, delivered_quantity: 9 }]);
    const stale = await dbInvoiceSetQuantities(db, a.userId, inv.id, inv.version, [{ line_id: inv.lines[0].id, delivered_quantity: 7 }]);
    expect(stale).toMatchObject({ done: false, reason: "version_conflict" });
    expect(stale.current!.version).toBe(first.invoice!.version);
    expect(stale.current!.lines[0].delivered_quantity).toBe(9);
    expect(await dbInvoiceSetQuantities(db, a.userId, inv.id, null, [{ line_id: inv.lines[0].id, delivered_quantity: 7 }])).toMatchObject({ done: false, reason: "version_conflict" });
  });

  it("writes an edited event with the old and new quantity, and none when nothing changed", async () => {
    const { inv } = await draft();
    const same = await dbInvoiceSetQuantities(db, a.userId, inv.id, inv.version, [{ line_id: inv.lines[0].id, delivered_quantity: 10 }]);
    expect(same.done).toBe(true);
    expect(same.invoice!.version).toBe(inv.version);
    expect(same.invoice!.events!.map((e) => e.event_type)).toEqual(["created"]);

    const changed = await dbInvoiceSetQuantities(db, a.userId, inv.id, inv.version, [{ line_id: inv.lines[0].id, delivered_quantity: 6 }]);
    const edited = changed.invoice!.events![0];
    expect(edited.event_type).toBe("edited");
    expect(edited.mine).toBe(true);
    expect(edited.detail).toMatchObject({ edited: { changes: [{ line_id: inv.lines[0].id, name: inv.lines[0].name, old: 10, new: 6 }] } });
  });

  it("refuses an issued invoice", async () => {
    const { inv } = await draft();
    const issued = await issueInvoice(db, a.userId, inv);
    const res = await dbInvoiceSetQuantities(db, a.userId, inv.id, issued.version, [{ line_id: inv.lines[0].id, delivered_quantity: 1 }]);
    expect(res).toMatchObject({ done: false, reason: "invoice_not_draft" });
    expect(res.current!.status).toBe("issued");
    const again = await dbInvoiceIssue(db, a.userId, inv.id, issued.version);
    expect(again).toMatchObject({ done: true, replayed: true });
  });

  it("answers for another business's invoice exactly like a missing one", async () => {
    const { inv } = await draft();
    const foreign = await dbInvoiceSetQuantities(db, b.userId, inv.id, inv.version, [{ line_id: inv.lines[0].id, delivered_quantity: 1 }]);
    const missing = await dbInvoiceSetQuantities(db, b.userId, randomUUID(), 1, [{ line_id: inv.lines[0].id, delivered_quantity: 1 }]);
    expect(foreign).toEqual(missing);
    expect(foreign).toEqual({ done: false, reason: "not_found" });
  });
});
