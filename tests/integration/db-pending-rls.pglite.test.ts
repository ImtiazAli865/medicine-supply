import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";
import { linkBody, priceBody, registerBody } from "../helpers/pending";
import { catalogLine, createPendingOrder, dbCandidates, dbLink, dbPreview, dbPriceApply, dbPricesList, dbRegister, dbSummary, dbTypedGroups, insertMedicine, insertStore, refetch, typedLine, type PendingOrder } from "../helpers/pending-db";

// Business isolation for every Module 004 function on a real PostgreSQL engine (PGlite), with crafted ids.
// Business B must never read, register into, link, propose, price or fill business A's data, a refusal must look
// exactly like a missing id, and not one row of A may change.

let db: PGlite;
let a: Tenant;
let b: Tenant;
let storeA: string;
let storeB: string;
let productA: string;
let productB: string;
let orderA: PendingOrder & { typedId: string };
let confirmedA: PendingOrder;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
  b = await createTenant(db, "b");
  storeA = await insertStore(db, a.businessId, "A Store");
  storeB = await insertStore(db, b.businessId, "B Store");
  productA = await insertMedicine(db, a.businessId, { name: "Secret A Medicine", unit: "strip" });
  productB = await insertMedicine(db, b.businessId, { name: "B Medicine", unit: "strip" });
  const typed = await createPendingOrder(db, a.userId, storeA, [typedLine("Secret A Medicine", 3, "strip"), catalogLine(productA, 2, "strip")], { confirm: true });
  orderA = { ...typed, typedId: typed.lineIds[0] };
  confirmedA = await createPendingOrder(db, a.userId, storeA, [catalogLine(productA, 5, "strip")], { confirm: true });
}, 60_000);

afterAll(async () => {
  await db.close();
});

/** A fingerprint of everything of A that this module could touch. */
async function stateOfA(): Promise<string> {
  const r = await db.query<{ s: string }>(
    `select md5(concat_ws('|',
       (select coalesce(string_agg(x::text, ',' order by x.id), '') from public.order_lines x where x.business_id = $1),
       (select coalesce(string_agg(x::text, ',' order by x.id), '') from public.orders x where x.business_id = $1),
       (select coalesce(string_agg(x::text, ',' order by x.id), '') from public.products x where x.business_id = $1),
       (select coalesce(string_agg(x::text, ',' order by x.id), '') from public.order_events x where x.business_id = $1),
       (select count(*)::text from public.pending_requests x where x.business_id = $1))) as s`,
    [a.businessId],
  );
  return r.rows[0].s;
}

describe("B can not reach A's data through any function", () => {
  it("register: a crafted order or line id of A gets exactly the answer of a missing id, and nothing of A changes", async () => {
    const before = await stateOfA();
    const crafted = await dbRegister(db, b.userId, orderA.id, orderA.typedId, registerBody(orderA.order.version, { name: "Intruder" }));
    const missing = await dbRegister(db, b.userId, randomUUID(), randomUUID(), registerBody(orderA.order.version, { name: "Intruder" }));
    expect(crafted).toEqual(missing);
    expect(crafted.done).toBe(false);
    expect(JSON.stringify(crafted)).not.toMatch(/Secret A|A Store/);
    expect(await stateOfA()).toBe(before);
    expect((await db.query(`select 1 from public.products where name = 'Intruder'`)).rows).toHaveLength(0);
  });

  it("register: B's own order with A's typed line id (or the reverse) is refused the same way", async () => {
    const own = await createPendingOrder(db, b.userId, storeB, [typedLine("B typed", 1, "strip")]);
    const before = await stateOfA();
    const mixed = await dbRegister(db, b.userId, own.id, orderA.typedId, registerBody(own.order.version, { name: "Mixed" }));
    const missing = await dbRegister(db, b.userId, own.id, randomUUID(), registerBody(own.order.version, { name: "Mixed" }));
    expect(mixed).toEqual(missing);
    expect(await stateOfA()).toBe(before);
    expect((await refetch(db, b.userId, own.id)).lines[0].product_id).toBeNull();
  });

  it("link: A's order, A's line or A's medicine is refused like a missing id, and nothing of A changes", async () => {
    const own = await createPendingOrder(db, b.userId, storeB, [typedLine("B typed link", 1, "strip")]);
    const before = await stateOfA();
    const crafted = await dbLink(db, b.userId, orderA.id, orderA.typedId, linkBody(orderA.order.version, productB));
    const missing = await dbLink(db, b.userId, randomUUID(), randomUUID(), linkBody(orderA.order.version, productB));
    expect(crafted).toEqual(missing);
    const foreignProduct = await dbLink(db, b.userId, own.id, own.lineIds[0], linkBody(own.order.version, productA));
    const missingProduct = await dbLink(db, b.userId, own.id, own.lineIds[0], linkBody(own.order.version, randomUUID()));
    expect(foreignProduct).toEqual(missingProduct);
    expect(foreignProduct.done).toBe(false);
    expect(await stateOfA()).toBe(before);
    expect((await refetch(db, b.userId, own.id)).lines[0].product_id).toBeNull();
  });

  it("candidates and price preview: A's medicine answers like a missing one and reveals no lines", async () => {
    const candidates = await dbCandidates(db, b.userId, productA);
    expect(candidates).toEqual(await dbCandidates(db, b.userId, randomUUID()));
    expect(candidates).toEqual({ ok: false, reason: "product_not_found" });
    const preview = await dbPreview(db, b.userId, productA, "10");
    expect(preview).toEqual(await dbPreview(db, b.userId, randomUUID(), "10"));
    expect(preview.ok).toBe(false);
  });

  it("price apply: A's medicine is refused like a missing one; A's line ids sent for B's own medicine fill nothing of A", async () => {
    const before = await stateOfA();
    const foreign = await dbPriceApply(db, b.userId, productA, priceBody("10", [confirmedA.lineIds[0]]));
    const missing = await dbPriceApply(db, b.userId, randomUUID(), priceBody("10", [confirmedA.lineIds[0]]));
    expect(foreign).toEqual(missing);
    expect(foreign.done).toBe(false);

    // B's own medicine with crafted line ids of A: only B's own waiting lines count, so the list does not match
    const ownOrder = await createPendingOrder(db, b.userId, storeB, [catalogLine(productB, 1, "strip")], { confirm: true });
    const crafted = await dbPriceApply(db, b.userId, productB, priceBody("10", [confirmedA.lineIds[0], ...ownOrder.lineIds]));
    expect(crafted).toMatchObject({ done: false, reason: "list_changed" });
    expect(crafted.current_lines!.map((l) => l.line_id)).toEqual(ownOrder.lineIds); // only B's own line is described
    expect(JSON.stringify(crafted)).not.toMatch(new RegExp(confirmedA.lineIds[0]));
    expect(await stateOfA()).toBe(before);
  });

  it("summary and the two lists contain not one row of A", async () => {
    const summary = await dbSummary(db, b.userId);
    expect(summary.typed_lines).toBe(await countTyped(b.businessId));
    const typed = await dbTypedGroups(db, b.userId);
    expect(JSON.stringify(typed)).not.toMatch(/Secret A|A Store/);
    const prices = await dbPricesList(db, b.userId);
    expect(JSON.stringify(prices)).not.toMatch(/Secret A/);
    expect(prices.items.some((i) => i.product_id === productA)).toBe(false);
    // and A still sees its own
    expect((await dbSummary(db, a.userId)).typed_lines).toBeGreaterThanOrEqual(1);
  });
});

async function countTyped(businessId: string): Promise<number> {
  const r = await db.query<{ n: string }>(
    `select count(*) as n from public.order_lines ol join public.orders o on o.id = ol.order_id
      where ol.business_id = $1 and ol.product_id is null and ol.removed_at is null and o.status in ('draft', 'confirmed')`,
    [businessId],
  );
  return Number(r.rows[0].n);
}

describe("request ids are per business", () => {
  it("a request id used by A is not replayed for B (register, link and price apply)", async () => {
    const sharedRegister = randomUUID();
    const aReg = await createPendingOrder(db, a.userId, storeA, [typedLine("Shared Id Reg", 1, "strip")], { confirm: true });
    const bReg = await createPendingOrder(db, b.userId, storeB, [typedLine("Shared Id Reg", 1, "strip")], { confirm: true });
    const forA = await dbRegister(db, a.userId, aReg.id, aReg.lineIds[0], { ...registerBody(aReg.order.version, { name: "Shared Id Reg" }), request_id: sharedRegister });
    expect(forA).toMatchObject({ done: true, replayed: false });
    const forB = await dbRegister(db, b.userId, bReg.id, bReg.lineIds[0], { ...registerBody(bReg.order.version, { name: "Shared Id Reg" }), request_id: sharedRegister });
    expect(forB).toMatchObject({ done: true, replayed: false }); // B's own request, not A's stored answer
    expect(forB.product!.id).not.toBe(forA.product!.id);
    expect((await refetch(db, b.userId, bReg.id)).lines[0].product_id).toBe(forB.product!.id);

    const sharedLink = randomUUID();
    const aLink = await createPendingOrder(db, a.userId, storeA, [typedLine("Shared Id Link", 1, "strip")]);
    const bLink = await createPendingOrder(db, b.userId, storeB, [typedLine("Shared Id Link", 1, "strip")]);
    const linkA = await dbLink(db, a.userId, aLink.id, aLink.lineIds[0], { ...linkBody(aLink.order.version, productA), request_id: sharedLink });
    const linkB = await dbLink(db, b.userId, bLink.id, bLink.lineIds[0], { ...linkBody(bLink.order.version, productB), request_id: sharedLink });
    expect(linkA).toMatchObject({ done: true, replayed: false });
    expect(linkB).toMatchObject({ done: true, replayed: false });
    expect(linkB.product!.id).toBe(productB);

    const sharedPrice = randomUUID();
    const priceProductA = await insertMedicine(db, a.businessId, { name: "Shared price A", unit: "strip" });
    const priceProductB = await insertMedicine(db, b.businessId, { name: "Shared price B", unit: "strip" });
    const oa = await createPendingOrder(db, a.userId, storeA, [catalogLine(priceProductA, 1, "strip")], { confirm: true });
    const ob = await createPendingOrder(db, b.userId, storeB, [catalogLine(priceProductB, 1, "strip")], { confirm: true });
    const pa = await dbPriceApply(db, a.userId, priceProductA, { request_id: sharedPrice, price: "10", line_ids: oa.lineIds, fill_lines: true });
    const pb = await dbPriceApply(db, b.userId, priceProductB, { request_id: sharedPrice, price: "20", line_ids: ob.lineIds, fill_lines: true });
    expect(pa).toMatchObject({ done: true, replayed: false });
    expect(pb).toMatchObject({ done: true, replayed: false });
    expect((await refetch(db, b.userId, ob.id)).lines[0].selling_price).toBe("20.00");
  });
});

describe("tables and functions are closed to everyone else", () => {
  it("the idempotency table can be neither read nor written by a signed-in user or a visitor", async () => {
    for (const [role, user] of [["authenticated", a.userId], ["authenticated", b.userId], ["anon", null]] as const) {
      await withRole(db, role, user, async () => {
        await expect(db.query(`select * from public.pending_requests`)).rejects.toThrow(/permission denied/);
        await expect(db.query(`insert into public.pending_requests (business_id, request_id, kind, result) values ($1, $2, 'link', '{}')`, [a.businessId, randomUUID()])).rejects.toThrow(/permission denied/);
        await expect(db.query(`delete from public.pending_requests`)).rejects.toThrow(/permission denied/);
      });
    }
  });

  it("a signed-out visitor can call none of the functions, and the internal helper is not callable by anyone", async () => {
    const calls = [
      `select public.pending_summary()`,
      `select public.pending_typed_groups(null, 10, 0)`,
      `select public.pending_prices_list(null, false, 10, 0)`,
      `select public.pending_candidates('${randomUUID()}')`,
      `select public.pending_price_preview('${randomUUID()}', '10')`,
      `select public.pending_price_apply('${randomUUID()}', '10', '${randomUUID()}', '{}', false)`,
      `select public.pending_line_link('${randomUUID()}', '${randomUUID()}', '${randomUUID()}', 1, '${randomUUID()}', false, 'existing')`,
    ];
    await withRole(db, "anon", null, async () => {
      for (const sql of calls) await expect(db.query(sql), sql).rejects.toThrow(/permission denied/);
    });
    await withRole(db, "authenticated", a.userId, async () => {
      await expect(db.query(`select public.pending_link_line('${a.businessId}', '${randomUUID()}', '${randomUUID()}', null, 'existing', false)`)).rejects.toThrow(/permission denied|does not exist/);
    });
  });

  it("a signed-in user without a business is refused by every read and write function", async () => {
    const lone = await db.query<{ id: string }>(`insert into auth.users (email) values ('lone-rls@example.test') returning id`);
    const user = lone.rows[0].id;
    await expect(dbSummary(db, user)).rejects.toThrow(/no_business/);
    await expect(dbTypedGroups(db, user)).rejects.toThrow(/no_business/);
    await expect(dbPricesList(db, user)).rejects.toThrow(/no_business/);
    await expect(dbCandidates(db, user, randomUUID())).rejects.toThrow(/no_business/);
    await expect(dbPreview(db, user, randomUUID(), "10")).rejects.toThrow(/no_business/);
    await expect(dbPriceApply(db, user, randomUUID(), priceBody("10", []))).rejects.toThrow(/no_business/);
    await expect(dbLink(db, user, randomUUID(), randomUUID(), linkBody(1, randomUUID()))).rejects.toThrow(/no_business/);
    await expect(dbRegister(db, user, randomUUID(), randomUUID(), registerBody(1))).rejects.toThrow(/no_business/);
  });
});
