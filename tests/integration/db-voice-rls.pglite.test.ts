import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";
import { typedLine } from "../helpers/orders";
import { dbDiagAdd, dbDiagList, dbMatchProducts, dbMatchStores, dbParseAllow, dbVoiceSave, rawDiagnostics, seedVoiceCatalog, type VoiceCatalog } from "../helpers/voice-db";

// Isolation of everything Module 008 added, on a real PostgreSQL engine: two businesses, crafted ids, direct table
// access, and a signed-out caller. A request for another business's id gets the answer of an unusable id and changes
// nothing.

let db: PGlite;
let a: Tenant;
let b: Tenant;
let catA: VoiceCatalog;
let catB: VoiceCatalog;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "voice-rls-a");
  b = await createTenant(db, "voice-rls-b");
  catA = await seedVoiceCatalog(db, a.businessId);
  catB = await seedVoiceCatalog(db, b.businessId);
}, 120_000);

afterAll(async () => {
  await db.close();
});

async function count(table: string, businessId?: string): Promise<number> {
  const res = await db.query<{ n: string }>(`select count(*)::text as n from public.${table}${businessId ? " where business_id = $1" : ""}`, businessId ? [businessId] : []);
  return Number(res.rows[0].n);
}

async function throws(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

describe("matching never crosses a business", () => {
  it("returns only the caller's own records, never the other business's ids", async () => {
    const aIds = new Set(Object.values(catA.products));
    const bIds = new Set(Object.values(catB.products));
    const forA = await dbMatchProducts(db, a.userId, ["Panadol", "Brufen", "Augmentin 625", "Calpol Syrup"]);
    expect(forA.length).toBeGreaterThan(0);
    expect(forA.every((r) => aIds.has(r.id) && !bIds.has(r.id))).toBe(true);
    const forB = await dbMatchProducts(db, b.userId, ["Panadol", "Brufen", "Augmentin 625", "Calpol Syrup"]);
    expect(forB.length).toBe(forA.length);
    expect(forB.every((r) => bIds.has(r.id) && !aIds.has(r.id))).toBe(true);

    const storesA = await dbMatchStores(db, a.userId, "Al Madina Medical");
    const storesB = await dbMatchStores(db, b.userId, "Al Madina Medical");
    expect(storesA.every((s) => Object.values(catA.stores).includes(s.id))).toBe(true);
    expect(storesB.every((s) => Object.values(catB.stores).includes(s.id))).toBe(true);
  });

  it("a business with no records gets no candidates, not another business's", async () => {
    const empty = await createTenant(db, "voice-rls-empty");
    expect(await dbMatchProducts(db, empty.userId, ["Panadol", "Brufen"])).toEqual([]);
    expect(await dbMatchStores(db, empty.userId, "Al Madina Medical")).toEqual([]);
  });
});

describe("the diagnostic log and the parse limit are per business", () => {
  it("lists only the caller's records and counts only the caller's rows", async () => {
    await dbDiagAdd(db, a.userId, { kind: "ai_busy", message: "A one" });
    await dbDiagAdd(db, a.userId, { kind: "ai_timeout", message: "A two" });
    await dbDiagAdd(db, b.userId, { kind: "ai_invalid", message: "B only" });
    const listA = await dbDiagList(db, a.userId);
    const listB = await dbDiagList(db, b.userId);
    expect(listA.total).toBe(2);
    expect(listA.items.map((r) => r.message).sort()).toEqual(["A one", "A two"]);
    expect(listB.total).toBe(1);
    expect(listB.items.map((r) => r.message)).toEqual(["B only"]);
    expect(await rawDiagnostics(db, a.businessId)).toHaveLength(2);
  });

  it("direct reads return only the caller's own rows", async () => {
    const own = await withRole(db, "authenticated", a.userId, async () => (await db.query<{ message: string }>(`select message from public.voice_diagnostics`)).rows);
    expect(own.map((r) => r.message).sort()).toEqual(["A one", "A two"]);
    const other = await withRole(db, "authenticated", b.userId, async () => (await db.query<{ message: string }>(`select message from public.voice_diagnostics`)).rows);
    expect(other.map((r) => r.message)).toEqual(["B only"]);
  });

  it("refuses a direct insert, update and delete of the diagnostic log, for the owner of the rows too", async () => {
    const before = await count("voice_diagnostics");
    const attempts = [
      `insert into public.voice_diagnostics (business_id, kind, parser) values ('${a.businessId}', 'ai_busy', 'ai')`,
      `insert into public.voice_diagnostics (business_id, kind, parser) values ('${b.businessId}', 'ai_busy', 'ai')`,
      `update public.voice_diagnostics set message = 'changed'`,
      `delete from public.voice_diagnostics`,
    ];
    for (const sql of attempts) {
      expect(await withRole(db, "authenticated", a.userId, () => throws(() => db.exec(sql))), sql).toBe(true);
    }
    expect(await count("voice_diagnostics")).toBe(before);
    expect((await rawDiagnostics(db, a.businessId)).map((r) => r.message)).toEqual(["A one", "A two"]);
  });

  it("refuses any direct access to the parse attempts table", async () => {
    await dbParseAllow(db, a.userId);
    for (const sql of [
      `select * from public.voice_parse_attempts`,
      `insert into public.voice_parse_attempts (business_id) values ('${a.businessId}')`,
      `update public.voice_parse_attempts set business_id = business_id`,
      `delete from public.voice_parse_attempts`,
    ]) {
      expect(await withRole(db, "authenticated", a.userId, () => throws(() => db.query(sql))), sql).toBe(true);
    }
    expect(await count("voice_parse_attempts", a.businessId)).toBeGreaterThanOrEqual(1);
  });

  it("counts one business's parses without touching the other's allowance", async () => {
    const x = await createTenant(db, "voice-rls-limit-x");
    const y = await createTenant(db, "voice-rls-limit-y");
    for (let i = 0; i < 20; i += 1) expect((await dbParseAllow(db, x.userId)).allowed).toBe(true);
    expect((await dbParseAllow(db, x.userId)).allowed).toBe(false);
    expect((await dbParseAllow(db, y.userId)).allowed).toBe(true);
  });
});

describe("a signed-out caller reaches nothing", () => {
  it("is refused by every voice function and the diagnostic table", async () => {
    const calls = [
      `select public.voice_parse_allow()`,
      `select public.voice_diag_add('ai_busy', 'ai', 0, 0, 0, 0, null)`,
      `select public.voice_diag_list(20, 0)`,
      `select public.voice_match_products('["Panadol"]'::jsonb)`,
      `select public.voice_match_stores('Al Madina Medical')`,
      `select * from public.voice_diagnostics`,
    ];
    for (const sql of calls) {
      expect(await withRole(db, "anon", null, () => throws(() => db.query(sql))), sql).toBe(true);
    }
  });

  it("a signed-in user without a business gets the no_business refusal or nothing, never data", async () => {
    const user = await db.query<{ id: string }>(`insert into auth.users (email) values ('voice-rls-nobusiness@example.test') returning id`);
    const userId = user.rows[0].id;
    for (const fn of [() => dbDiagList(db, userId), () => dbParseAllow(db, userId), () => dbDiagAdd(db, userId, { kind: "ai_busy" })]) {
      await expect(fn()).rejects.toThrow(/no_business/);
    }
    // matching reveals nothing at all
    expect(await dbMatchProducts(db, userId, ["Panadol"])).toEqual([]);
    expect(await dbMatchStores(db, userId, "Al Madina Medical")).toEqual([]);
  });
});

describe("the changed order save never crosses a business", () => {
  it("refuses another business's store, product line and order id with the answer of an unusable id", async () => {
    const orderId = randomUUID();
    const first = await dbVoiceSave(db, a.userId, orderId, catA.stores.madina, [typedLine("Thing", 1)], { spokenText: "Thing 1" });
    expect(first).toMatchObject({ saved: true, created: true });
    const ordersBefore = await count("orders");
    const linesBefore = await count("order_lines");

    // B reuses A's order id, with B's own store and a typed line
    const crafted = await dbVoiceSave(db, b.userId, orderId, catB.stores.madina, [typedLine("Stolen", 9)], { spokenText: "Stolen 9" });
    expect(crafted).toEqual({ saved: false, reason: "unusable_id" });
    // a missing id with an expected version answers like any missing order
    const missing = await dbVoiceSave(db, b.userId, randomUUID(), catB.stores.madina, [typedLine("Thing", 1)], { spokenText: "Thing 1", expectedVersion: 1 });
    expect(missing).toEqual({ saved: false, reason: "not_found" });
    // B tries A's store with a fresh id
    const foreignStore = await dbVoiceSave(db, b.userId, randomUUID(), catA.stores.madina, [typedLine("Thing", 1)], { spokenText: "Thing 1" });
    expect(foreignStore).toMatchObject({ saved: false, reason: "store_not_found" });

    expect(await count("orders")).toBe(ordersBefore);
    expect(await count("order_lines")).toBe(linesBefore);
    const stored = await db.query<{ spoken_text: string | null; business_id: string }>(`select spoken_text, business_id from public.orders where id = $1`, [orderId]);
    expect(stored.rows).toEqual([{ spoken_text: "Thing 1", business_id: a.businessId }]);
  });

  it("keeps each business's orders and spoken text readable only by that business", async () => {
    const idA = randomUUID();
    const idB = randomUUID();
    await dbVoiceSave(db, a.userId, idA, catA.stores.shifa, [typedLine("A item", 2)], { spokenText: "A said this" });
    await dbVoiceSave(db, b.userId, idB, catB.stores.shifa, [typedLine("B item", 3)], { spokenText: "B said this" });
    const seenByA = await withRole(db, "authenticated", a.userId, async () => (await db.query<{ id: string; spoken_text: string }>(`select id, spoken_text from public.orders where id in ($1, $2)`, [idA, idB])).rows);
    expect(seenByA).toEqual([{ id: idA, spoken_text: "A said this" }]);
    const seenByB = await withRole(db, "authenticated", b.userId, async () => (await db.query<{ id: string; spoken_text: string }>(`select id, spoken_text from public.orders where id in ($1, $2)`, [idA, idB])).rows);
    expect(seenByB).toEqual([{ id: idB, spoken_text: "B said this" }]);
  });
});
