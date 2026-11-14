import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createInvoiceDraft,
  dbInvoiceCancel,
  dbInvoiceSetQuantities,
  issueInvoice,
  seedInvoiceOrder,
} from "../helpers/invoices-db";
import { dbMarketList, dbMarketSummary, dbRecord, todayPkt } from "../helpers/market-db";
import { catalogLine, typedLine } from "../helpers/orders";
import { registerBody } from "../helpers/pending";
import { dbRegister, refetch } from "../helpers/pending-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import type { MarketList } from "../../src/lib/market/types";

// The market list (Module 005) must show the same requested, purchased and remaining figures whether an order is
// confirmed, fulfilled (invoice issued) or confirmed again (invoice cancelled).

let db: PGlite;
let a: Tenant;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
}, 60_000);

afterAll(async () => {
  await db.close();
});

const stable = (list: MarketList): MarketList => ({ ...list, generated_at: "" });

describe("market list and invoices", () => {
  it("shows the same figures before issuing, after issuing and after cancelling the invoice", async () => {
    const date = todayPkt();
    const seed = await seedInvoiceOrder(db, a);
    await dbRecord(db, a.userId, { product: seed.seeded.pricedId, unit: "strip", date, quantity: 4 });

    const before = stable(await dbMarketList(db, a.userId, { date }));
    const beforeSummary = await dbMarketSummary(db, a.userId, date);
    const panadol = before.rows.find((r) => r.product_id === seed.seeded.pricedId)!;
    expect(panadol).toMatchObject({ total_requested: 10, purchased: 4, remaining: 6, status: "partly_bought" });

    const draft = await createInvoiceDraft(db, a.userId, seed.order.id);
    // Delivering less than ordered must not change what the market list asks for.
    const edited = await dbInvoiceSetQuantities(db, a.userId, draft.id, draft.version, [{ line_id: draft.lines[0].id, delivered_quantity: 3 }]);
    const issued = await issueInvoice(db, a.userId, edited.invoice!);
    expect((await refetch(db, a.userId, seed.order.id)).status).toBe("fulfilled");

    expect(stable(await dbMarketList(db, a.userId, { date }))).toEqual(before);
    expect(await dbMarketSummary(db, a.userId, date)).toEqual(beforeSummary);

    expect(await dbInvoiceCancel(db, a.userId, issued.id, "Wrong quantity")).toMatchObject({ done: true });
    expect((await refetch(db, a.userId, seed.order.id)).status).toBe("confirmed");
    expect(stable(await dbMarketList(db, a.userId, { date }))).toEqual(before);
    expect(await dbMarketSummary(db, a.userId, date)).toEqual(beforeSummary);
  });

  it("keeps a typed line with delivered 0 on the list; it cannot be registered while the order is fulfilled (known limitation)", async () => {
    const date = todayPkt();
    const seed = await seedInvoiceOrder(db, a, { lines: (s) => [catalogLine(s.pricedId, 2, "strip"), typedLine("Zinnat 250mg", 6, "strip")] });
    const before = stable(await dbMarketList(db, a.userId, { date }));
    expect(before.typed_rows.some((r) => r.typed_name !== null && /zinnat/i.test(r.typed_name) && r.total_requested === 6)).toBe(true);

    const draft = await createInvoiceDraft(db, a.userId, seed.order.id);
    const typed = draft.lines.find((l) => l.typed)!;
    const zero = await dbInvoiceSetQuantities(db, a.userId, draft.id, draft.version, [{ line_id: typed.id, delivered_quantity: 0 }]);
    const issued = await issueInvoice(db, a.userId, zero.invoice!);

    // The market list is unchanged and still shows the typed line.
    expect(stable(await dbMarketList(db, a.userId, { date }))).toEqual(before);

    // Module 004 refuses to register a medicine on a fulfilled order: the line stays pending.
    const order = await refetch(db, a.userId, seed.order.id);
    const orderLine = order.lines.find((l) => l.product_id === null)!;
    const refused = await dbRegister(db, a.userId, seed.order.id, orderLine.id, registerBody(order.version, { name: "Zinnat 250mg" }));
    expect(refused.done).not.toBe(true);
    expect(refused.reason).toBeTruthy();
    expect((await refetch(db, a.userId, seed.order.id)).lines.find((l) => l.id === orderLine.id)).toMatchObject({ product_id: null, item_status: "pending_registration" });

    // After the invoice is cancelled the order is confirmed again and the medicine can be registered.
    await dbInvoiceCancel(db, a.userId, issued.id, "Register the medicine first");
    const confirmed = await refetch(db, a.userId, seed.order.id);
    const registered = await dbRegister(db, a.userId, seed.order.id, orderLine.id, registerBody(confirmed.version, { name: "Zinnat 250mg" }));
    expect(registered.done).toBe(true);
  });
});
