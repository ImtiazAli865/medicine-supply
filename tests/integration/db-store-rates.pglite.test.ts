import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogLine, savePayload, typedLine, type LineInput } from "../helpers/orders";
import { createDraft, dbConfirm, dbGet, dbList, dbSave, type FnResult } from "../helpers/orders-db";
import { createInvoiceDraft, issueInvoice } from "../helpers/invoices-db";
import { dbReportSales } from "../helpers/reports-db";
import { applyMigrationFile, createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";

// Module 012: store-specific selling prices. One price rule (typed, store rate, catalog, none), rates remembered
// through the order save, a price check at confirm, the rate list, and the Pending Prices flow.

interface Case {
  name: string;
  typedLine: boolean;
  chosen: string | null;
  rate: string | null;
  rateRemoved: boolean;
  productActive: boolean;
  lineUnit: string;
  productUnit: string;
  catalog: string | null;
  price: string | null;
  source: string | null;
}
const CASES = JSON.parse(readFileSync(path.resolve("tests/fixtures/effective-price-cases.json"), "utf8")) as Case[];

type Line = Record<string, unknown> & LineInput;
type Result = FnResult & { rate_conflicts?: Array<{ product_id: string; current_rate: string | null; current_version: number | null }> };

let db: PGlite;
let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
  b = await createTenant(db, "b");
});
afterAll(async () => {
  await db.close();
});

async function store(t: Tenant = a, name = `Store ${randomUUID().slice(0, 6)}`): Promise<string> {
  const id = randomUUID();
  await db.query(`insert into public.stores (id, business_id, name) values ($1, $2, $3)`, [id, t.businessId, name]);
  return id;
}

async function product(selling: string | null = "210.00", unit = "strip", t: Tenant = a): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into public.products (id, business_id, name, unit, selling_price, purchase_price, mrp) values ($1, $2, $3, $4, $5, 90, 300)`,
    [id, t.businessId, `Med ${id.slice(0, 8)}`, unit, selling],
  );
  return id;
}

const setCatalog = (id: string, price: string | null) => db.query(`update public.products set selling_price = $2 where id = $1`, [id, price]);

async function rpc<T>(userId: string, sql: string, params: unknown[]): Promise<T> {
  return withRole(db, "authenticated", userId, async () => (await db.query<{ r: T }>(sql, params)).rows[0].r);
}

type RateAnswer = { done: boolean; reason?: string; rate?: { rate: string; version: number }; current?: { rate: string; version: number } | null };
const rateSet = (s: string, p: string, rate: string, version: number | null = null, user = a.userId) =>
  rpc<RateAnswer>(user, `select public.store_rate_set($1, $2, $3, $4) as r`, [s, p, rate, version]);
const rateRemove = (s: string, p: string, version: number, user = a.userId) =>
  rpc<RateAnswer>(user, `select public.store_rate_remove($1, $2, $3) as r`, [s, p, version]);
const rateList = (s: string, user = a.userId) =>
  rpc<Array<{ product_id: string; rate: string; version: number; catalog_price_at_set: string | null; catalog_price: string | null }> | null>(
    user,
    `select public.store_rates_list($1) as r`,
    [s],
  );
const events = async (s: string) =>
  (await db.query<{ event_type: string; old_rate: string | null; new_rate: string | null; order_id: string | null }>(
    `select event_type, old_rate::text, new_rate::text, order_id from public.store_rate_events where store_id = $1 order by created_at, event_type`,
    [s],
  )).rows;

const line = (p: string, extra: Record<string, unknown> = {}, quantity = 2, unit = "strip"): Line => ({ ...catalogLine(p, quantity, unit), ...extra }) as Line;
const save = (orderId: string, s: string, lines: LineInput[], version: number | null = null, user = a.userId, requestId?: string) =>
  dbSave(db, user, orderId, savePayload(s, lines, { expected_version: version, ...(requestId ? { request_id: requestId } : {}) })) as Promise<Result>;
const priced = (r: FnResult) => r.order!.lines.map((l) => [(l as unknown as { selling_price: string | null }).selling_price, (l as unknown as { price_source: string | null }).price_source]);
const confirmWith = (orderId: string, version: number, expected: unknown) =>
  rpc<FnResult>(a.userId, `select public.order_confirm($1, $2, $3, $4::jsonb) as r`, [orderId, randomUUID(), version, JSON.stringify(expected)]);

async function draft(s: string, lines: LineInput[]) {
  const id = randomUUID();
  const r = await save(id, s, lines);
  expect(r.saved, JSON.stringify(r)).toBe(true);
  return { id, order: r.order!, result: r };
}

describe("the new tables", () => {
  it("have row level security, no write grants, and an append-only history", async () => {
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relname in ('store_rates', 'store_rate_events') order by relname`,
    );
    expect(rls.rows).toEqual([
      { relname: "store_rate_events", relrowsecurity: true },
      { relname: "store_rates", relrowsecurity: true },
    ]);
    const s = await store();
    const p = await product();
    await rateSet(s, p, "220");
    for (const sql of [
      `insert into public.store_rates (business_id, store_id, product_id, rate) values ('${a.businessId}', '${s}', '${p}', 1)`,
      `update public.store_rates set rate = 1 where store_id = '${s}'`,
      `delete from public.store_rates where store_id = '${s}'`,
    ]) {
      await expect(withRole(db, "authenticated", a.userId, () => db.query(sql)), sql).rejects.toThrow(/permission denied/);
    }
    await expect(db.query(`update public.store_rate_events set new_rate = 1 where store_id = $1`, [s])).rejects.toThrow(/append_only/);
    await expect(db.query(`delete from public.store_rate_events where store_id = $1`, [s])).rejects.toThrow(/append_only/);
    // Only the service role may delete (test clean-up); Supabase gives it the table rights that PGlite does not.
    await db.exec(`grant delete, select on public.store_rate_events to service_role`);
    await withRole(db, "service_role", null, () => db.query(`delete from public.store_rate_events where store_id = $1`, [s]));
    expect(await events(s)).toEqual([]);
  });

  it("hide another business's rates, and refuse a rate across businesses", async () => {
    const s = await store();
    const p = await product();
    await rateSet(s, p, "220");
    expect(await rateList(s, b.userId)).toBeNull();
    expect(await rateSet(s, p, "1", null, b.userId)).toMatchObject({ done: false, reason: "not_found" });
    expect(await rateRemove(s, p, 1, b.userId)).toMatchObject({ done: false, reason: "not_found" });
    const seen = await withRole(db, "authenticated", b.userId, () => db.query(`select * from public.store_rates`));
    expect(seen.rows).toEqual([]);
    const foreign = await product("5.00", "strip", b);
    await expect(
      db.query(`insert into public.store_rates (business_id, store_id, product_id, rate) values ($1, $2, $3, 1)`, [a.businessId, s, foreign]),
    ).rejects.toThrow(/foreign key/);
  });

  it("can be applied twice", async () => {
    await applyMigrationFile(db, "0012_store_rates.sql");
    const n = await db.query<{ n: number }>(`select count(*)::int as n from pg_proc where proname in ('order_confirm', 'pending_price_apply')`);
    expect(n.rows[0].n).toBe(2); // exactly one of each: no overload left behind
  });
});

describe("the one price rule", () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const s = await store();
      const p = await product(c.catalog, c.productUnit);
      if (c.rate !== null) {
        await db.query(`insert into public.store_rates (business_id, store_id, product_id, rate, removed_at) values ($1, $2, $3, $4, $5)`, [
          a.businessId, s, p, c.rate, c.rateRemoved ? new Date().toISOString() : null,
        ]);
      }
      if (!c.productActive) await db.query(`update public.products set is_active = false where id = $1`, [p]);
      const r = await db.query<{ price: string | null; source: string | null }>(
        `select price::text, source from public.order_line_effective_price($1, $2, $3, $4, $5)`,
        [a.businessId, s, c.typedLine ? null : p, c.lineUnit, c.chosen],
      );
      expect(r.rows[0]).toEqual({ price: c.price, source: c.source });
    });
  }
});

describe("a typed price on a draft", () => {
  it("is kept when the key is absent, cleared by null, and used by totals and the order list", async () => {
    const s = await store();
    const p = await product("210.00");
    const first = line(p, { price: "230" });
    const { id, order } = await draft(s, [first]);
    expect(priced({ order })).toEqual([["230.00", "typed"]]);
    expect(order.totals.priced_total).toBe("460.00");
    expect(order.lines[0]).toMatchObject({ chosen_price: "230.00", catalog_price: "210.00", price_basis: "current" });
    expect((await dbList(db, a.userId, { store: s }))[0].priced_total).toBe("460.00");

    const noKey = { ...line(p), id: first.id };
    const kept = await save(id, s, [noKey], order.version);
    expect(priced(kept)).toEqual([["230.00", "typed"]]);

    const cleared = await save(id, s, [{ ...noKey, price: null } as Line], kept.order!.version);
    expect(priced(cleared)).toEqual([["210.00", "catalog"]]);
  });

  it("is cleared when the unit changes without a new price", async () => {
    const s = await store();
    const p = await product("210.00");
    const first = line(p, { price: "230" });
    const { id, order } = await draft(s, [first]);
    const changed = await save(id, s, [{ ...line(p, {}, 2, "box"), id: first.id }], order.version);
    expect(priced(changed)).toEqual([["210.00", "catalog"]]);
  });

  it("refuses zero, text, three decimals and a price on a typed line, changing nothing", async () => {
    const s = await store();
    const p = await product();
    for (const price of ["0", "-1", "abc", "1.234", ""]) {
      const r = await save(randomUUID(), s, [line(p, { price })]);
      expect(r, price).toMatchObject({ saved: false, reason: "invalid_lines", detail: { message: "Enter a price above 0 with at most two decimals." } });
    }
    const typed = await save(randomUUID(), s, [{ ...typedLine("Noran"), price: "5" } as Line]);
    expect(typed).toMatchObject({ saved: false, detail: { message: "Register the medicine before setting its price." } });
    expect(await dbList(db, a.userId, { store: s })).toEqual([]);
  });

  it("is recorded at confirm with its source, never changes afterwards, and the event holds price and source", async () => {
    const s = await store();
    const p = await product("210.00");
    const q = await product("50.00");
    const first = line(p, { price: "230" });
    const second = line(q);
    const { id, order } = await draft(s, [first, second]);
    const done = await dbConfirm(db, a.userId, id, order.version);
    expect(done.confirmed).toBe(true);
    expect(priced(done)).toEqual([["230.00", "typed"], ["50.00", "catalog"]]);
    const event = done.order!.events.find((e) => e.event_type === "confirmed")!;
    expect((event.detail as { confirmed: { lines: unknown[] } }).confirmed.lines).toEqual([
      expect.objectContaining({ line_id: first.id, selling_price: "230.00", price_source: "typed" }),
      expect.objectContaining({ line_id: second.id, selling_price: "50.00", price_source: "catalog" }),
    ]);

    await setCatalog(p, "999.00");
    await rateSet(s, p, "500");
    expect(priced({ order: (await dbGet(db, a.userId, id))! })[0]).toEqual(["230.00", "typed"]);

    const refused = await save(id, s, [{ ...line(p, { price: "240" }), id: first.id }, { ...line(q), id: second.id }], done.order!.version);
    expect(refused).toMatchObject({ saved: false, detail: { message: "A recorded price cannot be changed." } });
    await expect(db.query(`update public.order_lines set chosen_price = 1 where id = $1`, [first.id])).rejects.toThrow(/snapshot_immutable/);
    await expect(db.query(`update public.order_lines set price_source = 'catalog' where id = $1`, [first.id])).rejects.toThrow(/snapshot_immutable/);
  });

  it("on a line added to a confirmed order is billed and written to the history as billed, after checking what was shown", async () => {
    const s = await store();
    const p = await product("210.00");
    const q = await product("50.00");
    await rateSet(s, q, "45");
    const first = line(p);
    const { id, order } = await draft(s, [first]);
    const done = await dbConfirm(db, a.userId, id, order.version);

    const stale = await save(id, s, [{ ...first }, line(q, { expected_price: "50.00" })], done.order!.version);
    expect(stale).toMatchObject({ saved: false, reason: "price_changed" });
    expect((await dbGet(db, a.userId, id))!.lines).toHaveLength(1);

    const added = await save(id, s, [{ ...first }, line(q, { expected_price: "45.00" })], done.order!.version);
    expect(added.saved, JSON.stringify(added)).toBe(true);
    expect(priced(added)[1]).toEqual(["45.00", "store_rate"]);
    const edited = added.order!.events.find((e) => e.event_type === "edited")!;
    expect((edited.detail as { edited: { changes: unknown[] } }).edited.changes).toEqual([
      expect.objectContaining({ type: "added", selling_price: "45.00", price_source: "store_rate" }),
    ]);
  });
});

describe("the price check at confirm", () => {
  it("confirms when the shown prices still hold, and changes nothing when the catalog or a rate moved", async () => {
    const s = await store();
    const p = await product("210.00");
    const first = line(p);
    const { id, order } = await draft(s, [first]);
    await setCatalog(p, "215.00");
    const moved = await confirmWith(id, order.version, [{ line_id: first.id, selling_price: "210.00" }]);
    expect(moved).toMatchObject({ confirmed: false, reason: "price_changed" });
    expect(priced({ order: moved.current! })).toEqual([["215.00", "catalog"]]);
    expect((await dbGet(db, a.userId, id))!.status).toBe("draft");

    await rateSet(s, p, "200");
    expect(await confirmWith(id, order.version, [{ line_id: first.id, selling_price: "215.00" }])).toMatchObject({ reason: "price_changed" });
    expect(await confirmWith(id, order.version, [])).toMatchObject({ reason: "price_changed" });
    expect(await confirmWith(id, order.version, [{ line_id: first.id, selling_price: "200.00" }])).toMatchObject({ confirmed: true });
  });

  it("accepts null for a line without a price", async () => {
    const s = await store();
    const p = await product(null);
    const first = line(p);
    const { id, order } = await draft(s, [first]);
    expect(await confirmWith(id, order.version, [{ line_id: first.id, selling_price: null }])).toMatchObject({ confirmed: true });
  });
});

describe("remembering a rate through the order save", () => {
  it("pre-fills the store's next order, never another store's, and records the order in the history", async () => {
    const [s1, s2, s3] = [await store(), await store(), await store()];
    const p = await product("210.00");
    const one = await draft(s1, [line(p, { price: "220", remember: true, rate_version: null })]);
    expect(one.result.rate_conflicts).toEqual([]);
    await draft(s2, [line(p, { price: "230", remember: true, rate_version: null })]);

    expect(priced((await draft(s1, [line(p)])).result)).toEqual([["220.00", "store_rate"]]);
    expect(priced((await draft(s2, [line(p)])).result)).toEqual([["230.00", "store_rate"]]);
    expect(priced((await draft(s3, [line(p)])).result)).toEqual([["210.00", "catalog"]]);
    expect(await events(s1)).toEqual([{ event_type: "set", old_rate: null, new_rate: "220.00", order_id: one.id }]);
    expect(await rateList(s1)).toEqual([expect.objectContaining({ product_id: p, rate: "220.00", version: 1, catalog_price_at_set: "210.00", catalog_price: "210.00" })]);
  });

  it("does not remember without the tick, or in another unit", async () => {
    const s = await store();
    const p = await product("210.00");
    await draft(s, [line(p, { price: "220" })]);
    await draft(s, [line(p, { price: "500", remember: true, rate_version: null }, 1, "box")]);
    expect(await rateList(s)).toEqual([]);
  });

  it("never overwrites a rate that changed meanwhile: the order is saved and the conflict is reported", async () => {
    const s = await store();
    const p = await product("210.00");
    await rateSet(s, p, "220");
    await rateSet(s, p, "225", 1);
    const r = await draft(s, [line(p, { price: "240", remember: true, rate_version: 1 })]);
    expect(r.result.rate_conflicts).toEqual([{ product_id: p, current_rate: "225.00", current_version: 2 }]);
    expect(priced(r.result)).toEqual([["240.00", "typed"]]);
    expect((await rateList(s))![0]).toMatchObject({ rate: "225.00", version: 2 });

    await rateRemove(s, p, 2);
    const again = await draft(s, [line(p, { price: "240", remember: true, rate_version: 2 })]);
    expect(again.result.rate_conflicts).toHaveLength(1);
    expect(await rateList(s)).toEqual([]); // a removed rate is not brought back by an old screen
  });

  it("writes no second history entry for a replay or the same value, and refreshes the catalog price it was agreed against", async () => {
    const s = await store();
    const p = await product("200.00");
    const request = randomUUID();
    const id = randomUUID();
    const first = line(p, { price: "220", remember: true, rate_version: null });
    await save(id, s, [first], null, a.userId, request);
    await save(id, s, [first], null, a.userId, request);
    await draft(s, [line(p, { price: "220", remember: true, rate_version: 1 })]);
    expect(await events(s)).toHaveLength(1);

    await setCatalog(p, "210.00");
    await draft(s, [line(p, { price: "220", remember: true, rate_version: 1 })]);
    expect((await rateList(s))![0]).toMatchObject({ rate: "220.00", version: 2, catalog_price_at_set: "210.00" });
  });

  it("is not callable directly by a user", async () => {
    await expect(
      withRole(db, "authenticated", a.userId, () => db.query(`select public.order_remember_rates($1, $1, $1, '[]'::jsonb)`, [a.businessId])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("managing rates", () => {
  it("sets, changes, removes and sets again, with version conflicts and history", async () => {
    const s = await store();
    const p = await product("210.00");
    expect(await rateSet(s, p, "220")).toMatchObject({ done: true, rate: { rate: "220.00", version: 1 } });
    expect(await rateSet(s, p, "225")).toMatchObject({ done: false, reason: "version_conflict", current: { version: 1 } });
    expect(await rateSet(s, p, "225", 1)).toMatchObject({ done: true, rate: { version: 2 } });
    expect(await rateRemove(s, p, 1)).toMatchObject({ done: false, reason: "version_conflict" });
    expect(await rateRemove(s, p, 2)).toMatchObject({ done: true });
    expect(await rateRemove(s, p, 2)).toMatchObject({ done: true });
    expect(await rateList(s)).toEqual([]);
    expect(await rateSet(s, p, "230")).toMatchObject({ done: true, rate: { rate: "230.00", version: 4 } });
    expect((await events(s)).map((e) => e.event_type).sort()).toEqual(["changed", "removed", "set", "set"]);
    for (const bad of ["0", "-2", "x", "1.999"]) expect(await rateSet(s, p, bad, 4), bad).toMatchObject({ done: false, reason: "invalid_rate" });
  });

  it("keeps a deactivated store's rates", async () => {
    const s = await store();
    const p = await product();
    await rateSet(s, p, "220");
    await db.query(`update public.stores set is_active = false where id = $1`, [s]);
    expect(await rateList(s)).toHaveLength(1);
  });

  it("lists every live rate page by page for the phone, selling prices only", async () => {
    const t = await createTenant(db, `c${randomUUID().slice(0, 6)}`);
    const s = await store(t);
    for (let i = 0; i < 3; i += 1) await rateSet(s, await product("10.00", "strip", t), "9", null, t.userId);
    const page = await rpc<Array<Record<string, unknown>>>(t.userId, `select public.store_rates_all($1, $2) as r`, [2, 0]);
    expect(page).toHaveLength(2);
    expect(Object.keys(page[0]).sort()).toEqual(["catalog_price_at_set", "product_id", "rate", "store_id", "version"]);
    expect(await rpc<unknown[]>(t.userId, `select public.store_rates_all($1, $2) as r`, [2, 2])).toHaveLength(1);
  });
});

describe("Register, Link and Pending Prices respect the store's rate", () => {
  it("fills the store's rate when a typed line is linked", async () => {
    const s = await store();
    const p = await product("210.00");
    await rateSet(s, p, "220");
    const typed = typedLine("Typed Med");
    const { id, order } = await draft(s, [typed]);
    const done = await dbConfirm(db, a.userId, id, order.version);
    const linked = await rpc<{ linked?: boolean; price_applied?: boolean; price_recorded?: string }>(
      a.userId,
      `select public.pending_line_link($1, $2, $3, $4, $5, $6, $7) as r`,
      [id, typed.id, randomUUID(), done.order!.version, p, true, "existing"],
    );
    expect(linked).toMatchObject({ price_applied: true });
    expect(priced({ order: (await dbGet(db, a.userId, id))! })).toEqual([["220.00", "store_rate"]]);
  });

  it("previews each line's price and applies exactly those", async () => {
    const p = await product(null);
    const [s1, s2] = [await store(), await store()];
    const lines: Array<{ order: string; line: string }> = [];
    for (const s of [s1, s2]) {
      const l = line(p);
      const { id, order } = await draft(s, [l]);
      await dbConfirm(db, a.userId, id, order.version);
      lines.push({ order: id, line: l.id });
    }
    await rateSet(s2, p, "230"); // saved after the order was confirmed without a price

    type Preview = { ok: boolean; lines: Array<{ line_id: string; price: string; price_source: string; line_total: string }> };
    const preview = await rpc<Preview>(a.userId, `select public.pending_price_preview($1, $2) as r`, [p, "215"]);
    expect(preview.lines.map((l) => [l.line_id, l.price, l.price_source, l.line_total])).toEqual([
      [lines[0].line, "215.00", "catalog", "430.00"],
      [lines[1].line, "230.00", "store_rate", "460.00"],
    ]);

    const ids = preview.lines.map((l) => l.line_id);
    const apply = (expected: unknown) =>
      rpc<{ done: boolean; reason?: string; current_lines?: unknown[] }>(
        a.userId,
        `select public.pending_price_apply($1, $2, $3, $4::uuid[], $5, $6::jsonb) as r`,
        [p, "215", randomUUID(), `{${ids.join(",")}}`, true, expected === null ? null : JSON.stringify(expected)],
      );
    // An older screen that did not see the store rate, and a screen with a stale price, are both refused.
    expect(await apply(null)).toMatchObject({ done: false, reason: "list_changed" });
    expect(await apply(preview.lines.map((l) => ({ line_id: l.line_id, price: "215.00" })))).toMatchObject({ reason: "list_changed" });
    expect(await apply(preview.lines.map((l) => ({ line_id: l.line_id, price: l.price })))).toMatchObject({ done: true });
    expect(priced({ order: (await dbGet(db, a.userId, lines[0].order))! })).toEqual([["215.00", "catalog"]]);
    expect(priced({ order: (await dbGet(db, a.userId, lines[1].order))! })).toEqual([["230.00", "store_rate"]]);
  });
});

describe("existing behaviour", () => {
  it("an order without rates or typed prices is saved and confirmed as before", async () => {
    const s = await store();
    const p = await product("125.50");
    const { id, order } = await createDraft(db, a.userId, s, [catalogLine(p, 2)]);
    const done = await dbConfirm(db, a.userId, id, order.version);
    expect(done).toMatchObject({ confirmed: true });
    expect(priced(done)).toEqual([["125.50", "catalog"]]);
  });
});

describe("a project that still has the dropped voice work", () => {
  it("ends with exactly one order_save, so saving is never ambiguous", async () => {
    const old = await createTestDb({ upTo: "0011_reports.sql" });
    // What migration 0009 left behind on the test and development projects: the six-argument form replaced by an eight-argument one.
    await old.exec(`
      drop function public.order_save(uuid, uuid, int, uuid, text, jsonb);
      create function public.order_save(p_id uuid, p_request_id uuid, p_expected_version int, p_store_id uuid, p_notes text, p_lines jsonb,
                                        p_source text default 'manual', p_spoken_text text default null)
        returns jsonb language sql as $$ select '{}'::jsonb $$;
    `);
    await applyMigrationFile(old, "0012_store_rates.sql");
    const res = await old.query<{ args: number }>(`select pronargs as args from pg_proc where proname = 'order_save'`);
    expect(res.rows).toEqual([{ args: 6 }]);
    await old.close();
  }, 60_000);
});

describe("invoices and reports use the store's negotiated price", () => {
  it("bills three stores their own prices without touching the catalog, and sales add up from those prices", async () => {
    const t = await createTenant(db, `inv${randomUUID().slice(0, 6)}`);
    const p = await product("210.00", "strip", t);
    const [aftab, rozi, naya] = [await store(t), await store(t), await store(t)];
    await rateSet(aftab, p, "220", null, t.userId);
    const billed: string[] = [];
    for (const [s, extra] of [[aftab, {}], [rozi, { price: "230" }], [naya, {}]] as Array<[string, Record<string, unknown>]>) {
      const { id, order } = await createDraft(db, t.userId, s, [{ ...catalogLine(p, 1), ...extra } as LineInput]);
      await dbConfirm(db, t.userId, id, order.version);
      const invoice = await issueInvoice(db, t.userId, await createInvoiceDraft(db, t.userId, id));
      billed.push((invoice as unknown as { lines: Array<{ selling_price: string }> }).lines[0]!.selling_price);
    }
    expect(billed).toEqual(["220.00", "230.00", "210.00"]);
    const catalog = await db.query<{ p: string }>(`select selling_price::text as p from public.products where id = $1`, [p]);
    expect(catalog.rows[0].p).toBe("210.00");
    const today = (await db.query<{ d: string }>(`select ((now() at time zone 'Asia/Karachi')::date)::text as d`)).rows[0].d;
    const sales = await dbReportSales(db, t.userId, today, today);
    expect(JSON.stringify(sales)).toContain("660.00"); // 220 + 230 + 210
  });
});
