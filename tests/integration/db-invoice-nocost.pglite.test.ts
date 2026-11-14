import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FORBIDDEN_KEY, scanForbiddenKeys } from "../helpers/invoices";
import {
  createInvoiceDraft,
  dbInvoiceCancel,
  dbInvoiceGet,
  dbInvoiceList,
  dbInvoiceSummary,
  dbInvoiceTodo,
  dbInvoicesOfOrder,
  dbOrderSheet,
  dbOrderSheetDay,
  issueInvoice,
  seedInvoiceOrder,
} from "../helpers/invoices-db";
import { todayPkt } from "../helpers/market-db";
import { catalogLine, typedLine } from "../helpers/orders";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// No invoice or order sheet output may ever carry a purchase price, MRP, cost, margin or profit (Principle II).
// The seeded medicines carry recognisable purchase prices (90.00, 200.00) and MRPs (130.00, 350.00), and the test
// looks for those values anywhere in every output.

let db: PGlite;
let a: Tenant;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
}, 60_000);

afterAll(async () => {
  await db.close();
});

/** The seeded cost values as whole numbers with two decimals, not part of a longer number. */
const COST_VALUES = /(?<![\d.])(90|130|200|350)\.00(?!\d)/;

function expectClean(label: string, value: unknown): void {
  expect(scanForbiddenKeys(value), `${label}: forbidden key`).toEqual([]);
  expect(JSON.stringify(value), `${label}: cost value`).not.toMatch(COST_VALUES);
}

describe("no cost on any invoice or order sheet output", () => {
  it("holds for drafts, issued and cancelled invoices, lists, summaries and order sheets", async () => {
    const date = todayPkt();
    const seed = await seedInvoiceOrder(db, a, { lines: (s) => [catalogLine(s.pricedId, 7, "strip"), catalogLine(s.sellingOnlyId, 3, "box"), typedLine("Noran 20mg cap", 2, "strip")] });
    const draft = await createInvoiceDraft(db, a.userId, seed.order.id);
    expectClean("draft", draft);
    expectClean("draft get", await dbInvoiceGet(db, a.userId, draft.id));

    const other = await seedInvoiceOrder(db, a);
    const second = await createInvoiceDraft(db, a.userId, other.order.id);
    const issued = await issueInvoice(db, a.userId, second);
    expectClean("issued", issued);
    const cancelled = await dbInvoiceCancel(db, a.userId, issued.id, "Wrong store");
    expectClean("cancelled", cancelled);

    expectClean("list", await dbInvoiceList(db, a.userId));
    expectClean("todo", await dbInvoiceTodo(db, a.userId));
    expectClean("summary", await dbInvoiceSummary(db, a.userId));
    expectClean("order invoices", await dbInvoicesOfOrder(db, a.userId, other.order.id));
    expectClean("order sheet", await dbOrderSheet(db, a.userId, [seed.order.id, other.order.id]));
    expectClean("order sheet day", await dbOrderSheetDay(db, a.userId, date));
  });

  it("holds because no function ever reads a cost column: the order's own events and totals are also clean in invoice history", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const draft = await createInvoiceDraft(db, a.userId, seed.order.id);
    const issued = await issueInvoice(db, a.userId, draft);
    const events = (issued.events ?? []).map((e) => e.detail);
    expectClean("events", events);
    // The same rule written on the key pattern itself: it must flag the usual suspects.
    for (const key of ["purchase_price", "purchase_price_snapshot", "mrp", "mrp_snapshot", "cost", "unit_cost", "margin", "profit", "gross_profit"]) {
      expect(FORBIDDEN_KEY.test(key), key).toBe(true);
    }
    for (const key of ["selling_price", "line_total", "grand_total", "delivered_quantity"]) {
      expect(FORBIDDEN_KEY.test(key), key).toBe(false);
    }
  });
});
