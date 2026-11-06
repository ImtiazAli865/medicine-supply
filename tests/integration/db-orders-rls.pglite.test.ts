import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogLine, savePayload, seedWithDb, typedLine, type Seeded } from "../helpers/orders";
import { createDraft, dbCancel, dbConfirm, dbGet, dbList, dbSave } from "../helpers/orders-db";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";

// Isolation between two businesses for orders, lines, history and order numbers, as the signed-in role.

let db: PGlite;
let a: Tenant;
let b: Tenant;
let seedA: Seeded;
let seedB: Seeded;
let orderB: { id: string; order: Awaited<ReturnType<typeof createDraft>>["order"] };

const asA = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", a.userId, fn);

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
  b = await createTenant(db, "b");
  seedA = await seedWithDb(db, a.businessId);
  seedB = await seedWithDb(db, b.businessId, "B Pharmacy");
  orderB = await createDraft(db, b.userId, seedB.storeId, [catalogLine(seedB.pricedId, 2), typedLine("B typed")], "B's private note");
  await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 1)]);
});
afterAll(async () => {
  await db.close();
});

describe("reading", () => {
  it("lets a business see only its own orders, lines and events with a direct select", async () => {
    for (const table of ["orders", "order_lines", "order_events"]) {
      const res = await asA(() => db.query<{ business_id: string }>(`select business_id from public.${table}`));
      expect(res.rows.length, table).toBeGreaterThan(0);
      expect(new Set(res.rows.map((r) => r.business_id)), table).toEqual(new Set([a.businessId]));
    }
  });

  it("order_get returns nothing for another business's order, and order_list never includes it", async () => {
    expect(await dbGet(db, a.userId, orderB.id)).toBeNull();
    const list = await dbList(db, a.userId);
    expect(list.map((r) => r.id)).not.toContain(orderB.id);
    expect(JSON.stringify(list)).not.toMatch(/B's private|B Pharmacy/);
  });

  it("numbers orders independently per business (both start at 1)", async () => {
    expect(orderB.order.order_number).toBe(1);
    expect((await dbList(db, a.userId))[0].order_number).toBe(1);
  });
});

describe("writing", () => {
  it("cannot save, confirm or cancel another business's order, and leaves it untouched", async () => {
    const before = (await dbGet(db, b.userId, orderB.id))!;
    const line = before.lines[0];
    const attempt = savePayload(seedA.storeId, [{ ...catalogLine(seedA.pricedId, 99), id: line.id }], { expected_version: before.version });
    expect(await dbSave(db, a.userId, orderB.id, attempt)).toEqual({ saved: false, reason: "not_found" }); // same answer as for an id that does not exist
    expect(await dbSave(db, a.userId, orderB.id, { ...attempt, expected_version: null })).toEqual({ saved: false, reason: "unusable_id" });
    expect(await dbConfirm(db, a.userId, orderB.id, before.version)).toEqual({ confirmed: false, reason: "not_found" });
    expect(await dbCancel(db, a.userId, orderB.id, before.version, "hostile")).toEqual({ cancelled: false, reason: "not_found" });
    expect(await dbGet(db, b.userId, orderB.id)).toEqual(before);
  });

  it("refuses another business's store, medicine and line id inside a payload", async () => {
    expect(await dbSave(db, a.userId, randomUUID(), savePayload(seedB.storeId, []))).toMatchObject({ saved: false, reason: "store_not_found" });
    expect(await dbSave(db, a.userId, randomUUID(), savePayload(seedA.storeId, [catalogLine(seedB.pricedId)]))).toMatchObject({ saved: false, reason: "invalid_lines" });
    const mine = await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 1)]);
    const foreignLine = { ...catalogLine(seedA.pricedId, 1), id: orderB.order.lines[0].id };
    expect(await dbSave(db, a.userId, mine.id, savePayload(seedA.storeId, [mine.order.lines[0] ? { ...catalogLine(seedA.pricedId, 1), id: mine.order.lines[0].id } : foreignLine, foreignLine], { expected_version: mine.order.version }))).toMatchObject({ saved: false, reason: "invalid_lines" });
  });

  it("refuses every direct write by a signed-in user, on all four tables", async () => {
    const statements = [
      `insert into public.orders (id, store_id, order_number) values ('${randomUUID()}', '${seedA.storeId}', 777)`,
      `update public.orders set notes = 'x'`,
      `delete from public.orders`,
      `update public.order_lines set quantity = 1`,
      `delete from public.order_lines`,
      `insert into public.order_events (order_id, event_type, order_version) values ('${orderB.id}', 'created', 1)`,
      `delete from public.order_events`,
      `select * from public.order_counters`,
    ];
    for (const sql of statements) {
      await expect(asA(() => db.query(sql)), sql).rejects.toThrow(/permission denied/i);
    }
  });

  it("changes nothing in the other business's tables when this business works", async () => {
    const counter = await db.query<{ last_number: number }>(`select last_number from public.order_counters where business_id = $1`, [b.businessId]);
    await createDraft(db, a.userId, seedA.storeId, [catalogLine(seedA.pricedId, 1)]);
    const after = await db.query<{ last_number: number }>(`select last_number from public.order_counters where business_id = $1`, [b.businessId]);
    expect(after.rows[0].last_number).toBe(counter.rows[0].last_number);
  });

  it("gives a signed-out role no access at all", async () => {
    await expect(withRole(db, "anon", null, () => db.query(`select * from public.orders`))).rejects.toThrow(/permission denied/i);
    await expect(withRole(db, "anon", null, () => db.query(`select public.order_get('${orderB.id}')`))).rejects.toThrow(/permission denied/i);
    await expect(withRole(db, "anon", null, () => db.query(`select public.order_save('${randomUUID()}', '${randomUUID()}', null, '${seedA.storeId}', null, '[]'::jsonb)`))).rejects.toThrow(/permission denied/i);
  });

  it("refuses an account that has no business", async () => {
    const orphan = await db.query<{ id: string }>(`insert into auth.users (email) values ('orphan@example.test') returning id`);
    await expect(
      withRole(db, "authenticated", orphan.rows[0].id, () => db.query(`select public.order_save('${randomUUID()}', '${randomUUID()}', null, '${seedA.storeId}', null, '[]'::jsonb)`)),
    ).rejects.toThrow(/no_business/);
    expect(await dbList(db, orphan.rows[0].id)).toEqual([]);
  });
});
