import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanForbiddenKeys } from "../helpers/invoices";
import { dbOrderSheet, dbOrderSheetDay, seedInvoiceOrder } from "../helpers/invoices-db";
import { addDays, pkt, setConfirmedAt, todayPkt } from "../helpers/market-db";
import { catalogLine, typedLine } from "../helpers/orders";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";

// order_sheet and order_sheet_day on PGlite (options A and B): quantities and units only, one section per order.

let db: PGlite;
let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
  b = await createTenant(db, "b");
  await db.query(`update public.business_settings set phone = '0300-1', address = 'Mall Road' where business_id = $1`, [a.businessId]);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("order_sheet (option A)", () => {
  it("returns the business header, the store, the order number and date and the lines with quantity and unit", async () => {
    const seed = await seedInvoiceOrder(db, a, { storeName: "Al Madina Medical", lines: (s) => [catalogLine(s.pricedId, 10, "strip"), typedLine("Noran 20mg cap", 4, "strip")] });
    const sheet = await dbOrderSheet(db, a.userId, [seed.order.id]);
    expect(sheet.business).toEqual({ name: "a business", phone: "0300-1", address: "Mall Road" });
    expect(sheet.sections).toHaveLength(1);
    const section = sheet.sections[0];
    expect(section).toMatchObject({ order_id: seed.order.id, order_number: seed.order.order.order_number, order_date: todayPkt() });
    expect(section.store).toMatchObject({ id: seed.seeded.storeId, name: "Al Madina Medical" });
    expect(section.lines.map((l) => [l.position, l.name, l.quantity, l.unit, l.unregistered])).toEqual([
      [1, seed.names.priced, 10, "strip", false],
      [2, "Noran 20mg cap", 4, "strip", true],
    ]);
  });

  it("has no price or cost anywhere, even when the lines carry them", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const sheet = await dbOrderSheet(db, a.userId, [seed.order.id]);
    expect(scanForbiddenKeys(sheet)).toEqual([]);
    expect(Object.keys(sheet.sections[0].lines[0]).sort()).toEqual(
      ["dosage_form", "manufacturer", "name", "pack_size", "position", "quantity", "strength", "unit", "unregistered"],
    );
    expect(JSON.stringify(sheet)).not.toMatch(/price|PKR|125\.50|310\.00/i);
  });

  it("skips removed lines, draft and cancelled orders, unknown ids and another business's orders", async () => {
    const seed = await seedInvoiceOrder(db, a);
    await db.query(`update public.order_lines set removed_at = now() where id = $1`, [seed.order.lineIds[1]]);
    const draft = await seedInvoiceOrder(db, a, { confirm: false });
    const cancelled = await seedInvoiceOrder(db, a);
    await db.query(`update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Test' where id = $1`, [cancelled.order.id]);
    const foreign = await seedInvoiceOrder(db, b);

    const sheet = await dbOrderSheet(db, a.userId, [seed.order.id, draft.order.id, cancelled.order.id, foreign.order.id, randomUUID()]);
    expect(sheet.sections.map((s) => s.order_id)).toEqual([seed.order.id]);
    expect(sheet.sections[0].lines).toHaveLength(1);
    expect(await dbOrderSheet(db, a.userId, [])).toMatchObject({ sections: [] });
    expect((await dbOrderSheet(db, b.userId, [seed.order.id])).sections).toEqual([]);
  });
});

describe("order_sheet_day (option B)", () => {
  it("gives one section per order and store, never mixing items of different stores", async () => {
    const day = "2026-10-05";
    const madina = await seedInvoiceOrder(db, a, { storeName: "Al Madina Medical", lines: (s) => [catalogLine(s.pricedId, 20, "strip")] });
    const shah = await seedInvoiceOrder(db, a, { storeName: "Shah Medical", lines: (s) => [catalogLine(s.pricedId, 10, "strip"), catalogLine(s.sellingOnlyId, 2, "box")] });
    const rehman = await seedInvoiceOrder(db, a, { storeName: "Rehman Medical", lines: () => [typedLine("Zinnat 250mg", 5, "strip")] });
    await setConfirmedAt(db, madina.order.id, pkt(day, "09:00"));
    await setConfirmedAt(db, shah.order.id, pkt(day, "11:00"));
    await setConfirmedAt(db, rehman.order.id, pkt(day, "23:30"));

    const sheet = await dbOrderSheetDay(db, a.userId, day);
    expect(sheet.sections.map((s) => s.store.name)).toEqual(["Al Madina Medical", "Shah Medical", "Rehman Medical"]);
    expect(sheet.sections[0].lines.map((l) => l.quantity)).toEqual([20]);
    expect(sheet.sections[1].lines.map((l) => [l.name, l.quantity])).toEqual([[shah.names.priced, 10], [shah.names.sellingOnly, 2]]);
    expect(sheet.sections[2].lines.map((l) => [l.name, l.unregistered])).toEqual([["Zinnat 250mg", true]]);
    expect(sheet.sections[0].order_date).toBe(day);
    expect(scanForbiddenKeys(sheet)).toEqual([]);

    // A store selection limits the sections; another day has none.
    const only = await dbOrderSheetDay(db, a.userId, day, [shah.seeded.storeId, rehman.seeded.storeId]);
    expect(only.sections.map((s) => s.store.name)).toEqual(["Shah Medical", "Rehman Medical"]);
    expect((await dbOrderSheetDay(db, a.userId, addDays(day, 1))).sections).toEqual([]);
    expect((await dbOrderSheetDay(db, a.userId, addDays(day, -1))).sections).toEqual([]);
  });

  it("uses the Pakistan day, counts fulfilled orders, and skips draft and cancelled ones", async () => {
    const day = "2026-10-06";
    const justAfterMidnight = await seedInvoiceOrder(db, a, { storeName: "Midnight" });
    const lateEvening = await seedInvoiceOrder(db, a, { storeName: "Evening" });
    const fulfilled = await seedInvoiceOrder(db, a, { storeName: "Fulfilled" });
    const cancelled = await seedInvoiceOrder(db, a, { storeName: "Cancelled" });
    await setConfirmedAt(db, justAfterMidnight.order.id, pkt(day, "00:05"));
    await setConfirmedAt(db, lateEvening.order.id, pkt(addDays(day, -1), "23:55"));
    await setConfirmedAt(db, fulfilled.order.id, pkt(day, "12:00"));
    await setConfirmedAt(db, cancelled.order.id, pkt(day, "13:00"));
    await db.query(`update public.orders set status = 'fulfilled' where id = $1`, [fulfilled.order.id]);
    await db.query(`update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Test' where id = $1`, [cancelled.order.id]);

    const sheet = await dbOrderSheetDay(db, a.userId, day);
    expect(sheet.sections.map((s) => s.store.name)).toEqual(["Midnight", "Fulfilled"]);
  });

  it("never shows another business's orders and returns nothing for an empty day", async () => {
    const day = "2026-10-07";
    const mine = await seedInvoiceOrder(db, a, { storeName: "Mine" });
    const theirs = await seedInvoiceOrder(db, b, { storeName: "Theirs" });
    await setConfirmedAt(db, mine.order.id, pkt(day, "10:00"));
    await setConfirmedAt(db, theirs.order.id, pkt(day, "10:00"));
    expect((await dbOrderSheetDay(db, a.userId, day)).sections.map((s) => s.store.name)).toEqual(["Mine"]);
    expect((await dbOrderSheetDay(db, b.userId, day)).sections.map((s) => s.store.name)).toEqual(["Theirs"]);
    expect((await dbOrderSheetDay(db, a.userId, "2030-01-01")).sections).toEqual([]);
  });
});
