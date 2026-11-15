import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { paisaToMoney, parseMoneyToPaisa } from "../../src/lib/money";
import { createInvoiceDraft, dbInvoiceGet, dbInvoiceSetQuantities, issueInvoice, seedInvoiceOrder, seedStoreAndMedicines } from "../helpers/invoices-db";
import { catalogLine } from "../helpers/orders";
import { createPendingOrder, insertMedicine } from "../helpers/pending-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import type { Invoice } from "../../src/lib/invoices/types";

// Totals are computed in SQL, exact to the paisa, and every line total is delivered quantity x snapshot price.

let db: PGlite;
let a: Tenant;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
}, 60_000);

afterAll(async () => {
  await db.close();
});

/** The sum of the billed line totals and every line total, recomputed here from the quantities and prices. */
function checkTotals(inv: Invoice): void {
  // Integer paisa stay far below Number.MAX_SAFE_INTEGER here (the largest test total is about 1.2e12 paisa).
  let sumPaisa = 0;
  for (const line of inv.lines) {
    if (line.selling_price === null) {
      expect(line.line_total).toBeNull();
      continue;
    }
    const price = parseMoneyToPaisa(line.selling_price);
    expect(price, `price of line ${line.position}`).not.toBeNull();
    const total = (price as number) * line.delivered_quantity;
    expect(line.line_total, `line ${line.position}`).toBe(paisaToMoney(total));
    if (line.delivered_quantity > 0) sumPaisa += total;
  }
  expect(inv.grand_total).toBe(paisaToMoney(sumPaisa));
}

describe("invoice totals", () => {
  it("are exact for prices with fractions, 0.00, large quantities and many lines", async () => {
    const { seeded } = await seedStoreAndMedicines(db, a.businessId);
    const prices = ["0.01", "0.07", "19.99", "125.50", "0.00", "999999.99", "33.33", "0.10", "7.77", "1234.56"];
    const ids: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      ids.push(await insertMedicine(db, a.businessId, { name: `Item ${i} ${randomUUID().slice(0, 4)}`, unit: "strip", selling_price: prices[i % prices.length] }));
    }
    const quantities = [1, 3, 7, 10, 99, 1000, 12345, 3];
    const order = await createPendingOrder(
      db,
      a.userId,
      seeded.storeId,
      ids.map((id, i) => catalogLine(id, quantities[i % quantities.length], "strip")),
      { confirm: true },
    );
    const inv = await createInvoiceDraft(db, a.userId, order.id);
    expect(inv.lines).toHaveLength(60);
    checkTotals(inv);

    // Changing quantities keeps every total exact.
    const changes = inv.lines.slice(0, 20).map((l, i) => ({ line_id: l.id, delivered_quantity: [0, 1, 2, 500, 100000][i % 5] }));
    const res = await dbInvoiceSetQuantities(db, a.userId, inv.id, inv.version, changes);
    expect(res.done).toBe(true);
    checkTotals(res.invoice!);

    // The issued total equals the recomputed sum, and it is what the stored header says.
    const ready = res.invoice!;
    if (ready.ready_to_issue) {
      const issued = await issueInvoice(db, a.userId, ready);
      checkTotals(issued);
      const stored = await db.query<{ grand_total: string }>(`select grand_total::text from public.invoices where id = $1`, [inv.id]);
      expect(stored.rows[0].grand_total).toBe(issued.grand_total);
    }
  });

  it("treat a price of 0.00 as a verified price and never show a missing price as 0", async () => {
    const seed = await seedInvoiceOrder(db, a, { lines: (s) => [catalogLine(s.pricedId, 2, "strip"), catalogLine(s.noPriceId, 3, "bottle")] });
    // A price of exactly 0.00 on a freshly confirmed order line:
    const free = await seedInvoiceOrder(db, a, { lines: (s) => [catalogLine(s.pricedId, 1, "strip")] });
    // The order guard protects confirmed snapshots; the test lifts it for this one setup update only.
    await db.query(`select set_config('app.line_snapshot_edit', 'on', false)`);
    await db.query(`update public.order_lines set selling_price_snapshot = '0.00' where order_id = $1`, [free.order.id]);
    await db.query(`select set_config('app.line_snapshot_edit', '', false)`);
    const freeInv = await createInvoiceDraft(db, a.userId, free.order.id);
    expect(freeInv.lines[0]).toMatchObject({ selling_price: "0.00", line_total: "0.00", needs_price: false });
    expect(freeInv.ready_to_issue).toBe(true);
    expect(freeInv.grand_total).toBe("0.00");

    const inv = await createInvoiceDraft(db, a.userId, seed.order.id);
    const unpriced = inv.lines.find((l) => l.name === seed.names.noPrice)!;
    expect(unpriced.selling_price).toBeNull();
    expect(unpriced.line_total).toBeNull();
    expect(unpriced.needs_price).toBe(true);
  });

  it("do not count a line with delivered 0, and an unpriced line with delivered 0 does not block", async () => {
    const seed = await seedInvoiceOrder(db, a, { lines: (s) => [catalogLine(s.pricedId, 2, "strip"), catalogLine(s.noPriceId, 3, "bottle")] });
    const inv = await createInvoiceDraft(db, a.userId, seed.order.id);
    expect(inv.ready_to_issue).toBe(false);
    const unpriced = inv.lines.find((l) => l.name === seed.names.noPrice)!;
    const res = await dbInvoiceSetQuantities(db, a.userId, inv.id, inv.version, [{ line_id: unpriced.id, delivered_quantity: 0 }]);
    expect(res.invoice).toMatchObject({ blockers: [], ready_to_issue: true, grand_total: "251.00" });
    const got = (await dbInvoiceGet(db, a.userId, inv.id)) as Invoice & { found: true };
    checkTotals(got);
  });
});
