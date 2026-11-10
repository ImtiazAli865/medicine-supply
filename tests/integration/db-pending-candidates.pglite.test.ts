import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbCancel } from "../helpers/orders-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import { createPendingOrder, dbCandidates, insertMedicine, insertStore, typedLine } from "../helpers/pending-db";

// Proposals after a medicine is registered or linked (pending_candidates) on a real PostgreSQL engine (PGlite):
// only clear matches are proposed, look-alikes are listed but never proposed, nothing is ever written.

let db: PGlite;
let counter = 0;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  await db.close();
});

/** Every scenario gets its own business so that one scenario's lines never show up in another's. */
async function business(): Promise<{ t: Tenant; storeId: string }> {
  counter += 1;
  const t = await createTenant(db, `cand${counter}`);
  return { t, storeId: await insertStore(db, t.businessId, `Store ${counter}`) };
}

const counts = async () =>
  (
    await db.query<Record<string, string>>(`
      select (select count(*) from public.order_lines) as lines, (select count(*) from public.order_events) as events,
             (select count(*) from public.products) as products, (select coalesce(sum(version), 0) from public.orders) as versions,
             (select count(*) from public.pending_requests) as requests`)
  ).rows[0];

describe("who is proposed", () => {
  it("proposes lines whose text equals the name, name + strength, or name + strength + dosage form, ignoring case and spacing", async () => {
    const { t, storeId } = await business();
    const noran = await insertMedicine(db, t.businessId, { name: "Noran", strength: "20 mg", dosage_form: "capsule" });
    const draft = await createPendingOrder(db, t.userId, storeId, [typedLine("noran", 4, "strip"), typedLine("Noran 20 mg", 2, "box")]);
    const confirmed = await createPendingOrder(db, t.userId, storeId, [typedLine("NORAN 20 MG CAPSULE", 7, "strip")], { confirm: true });
    // spacing is ignored: store a text with extra spaces the way an old order might have it
    await db.query(`update public.order_lines set name = 'Noran   20 mg   capsule' where id = $1`, [draft.lineIds[1]]);

    const res = await dbCandidates(db, t.userId, noran);
    expect(res.ok).toBe(true);
    expect(res.proposed.map((l) => l.line_id).sort()).toEqual([draft.lineIds[0], draft.lineIds[1], confirmed.lineIds[0]].sort());
    expect(res.not_proposed).toEqual([]);
    const byLine = Object.fromEntries(res.proposed.map((l) => [l.line_id, l]));
    expect(byLine[draft.lineIds[0]]).toMatchObject({ order_id: draft.id, order_number: draft.order.order_number, order_status: "draft", store_name: "Store " + counter, typed_text: "noran", quantity: 4, unit: "strip" });
    expect(byLine[confirmed.lineIds[0]]).toMatchObject({ order_status: "confirmed", typed_text: "NORAN 20 MG CAPSULE", quantity: 7 });
    expect(byLine[draft.lineIds[1]].typed_text).toBe("Noran   20 mg   capsule"); // shown exactly as typed
  });

  it("lists a look-alike with a different strength only under not_proposed, and ignores unrelated text", async () => {
    const { t, storeId } = await business();
    const noran20 = await insertMedicine(db, t.businessId, { name: "Noran 20mg cap" });
    const o1 = await createPendingOrder(db, t.userId, storeId, [typedLine("Noran 20mg cap", 1), typedLine("Noran 40mg cap", 2), typedLine("Panadol", 3)]);
    const res = await dbCandidates(db, t.userId, noran20);
    expect(res.proposed.map((l) => l.line_id)).toEqual([o1.lineIds[0]]);
    expect(res.not_proposed.map((l) => l.line_id)).toEqual([o1.lineIds[1]]);
    expect(res.not_proposed[0].typed_text).toBe("Noran 40mg cap");
    expect([...res.proposed, ...res.not_proposed].some((l) => l.typed_text === "Panadol")).toBe(false);
  });

  it("does not propose a text that could equal two different active medicines, but still lists it as not proposed", async () => {
    const { t, storeId } = await business();
    const a = await insertMedicine(db, t.businessId, { name: "Noran", strength: "20 mg" });
    const b = await insertMedicine(db, t.businessId, { name: "Noran 20 mg" });
    const o = await createPendingOrder(db, t.userId, storeId, [typedLine("Noran 20 mg", 1)]);
    for (const id of [a, b]) {
      const res = await dbCandidates(db, t.userId, id);
      expect(res.proposed).toEqual([]);
      expect(res.not_proposed.map((l) => l.line_id)).toEqual(o.lineIds);
    }
    // an inactive medicine with the same label no longer makes the text ambiguous
    await db.query(`update public.products set is_active = false where id = $1`, [b]);
    const after = await dbCandidates(db, t.userId, a);
    expect(after.proposed.map((l) => l.line_id)).toEqual(o.lineIds);
  });

  it("never lists lines of cancelled orders, removed lines, linked lines or lines of other businesses", async () => {
    const { t, storeId } = await business();
    const other = await business();
    const noran = await insertMedicine(db, t.businessId, { name: "Noran" });
    const cancelled = await createPendingOrder(db, t.userId, storeId, [typedLine("Noran", 1)], { confirm: true });
    const cancelResult = await dbCancel(db, t.userId, cancelled.id, cancelled.order.version, "test");
    expect(cancelResult.cancelled).toBe(true);
    const live = await createPendingOrder(db, t.userId, storeId, [typedLine("Noran", 2), typedLine("Noran", 3), typedLine("Noran", 4)]);
    await db.query(`update public.order_lines set removed_at = now() where id = $1`, [live.lineIds[1]]);
    await db.query(`update public.order_lines set product_id = $2, item_status = 'registered' where id = $1`, [live.lineIds[2], noran]);
    await createPendingOrder(db, other.t.userId, other.storeId, [typedLine("Noran", 9)]);

    const res = await dbCandidates(db, t.userId, noran);
    expect(res.proposed.map((l) => l.line_id)).toEqual([live.lineIds[0]]);
    expect(res.not_proposed).toEqual([]);
  });

  it("answers product_not_found for a medicine of another business or an unknown id, revealing nothing", async () => {
    const { t } = await business();
    const other = await business();
    const foreign = await insertMedicine(db, other.t.businessId, { name: "Foreign" });
    await createPendingOrder(db, other.t.userId, other.storeId, [typedLine("Foreign", 1)]);
    for (const id of [foreign, "00000000-0000-4000-8000-000000000000"]) {
      const res = await dbCandidates(db, t.userId, id);
      expect(res).toEqual({ ok: false, reason: "product_not_found" });
    }
  });

  it("orders the lines by order number and caps each group at 200", async () => {
    const { t, storeId } = await business();
    const noran = await insertMedicine(db, t.businessId, { name: "Noran" });
    const many = (text: string) => Array.from({ length: 110 }, () => typedLine(text, 1));
    const first = await createPendingOrder(db, t.userId, storeId, many("Noran"));
    const second = await createPendingOrder(db, t.userId, storeId, many("Noran"));
    const alike = await createPendingOrder(db, t.userId, storeId, many("Noran 5 mg"));
    const alike2 = await createPendingOrder(db, t.userId, storeId, many("Noran 10 mg"));
    const res = await dbCandidates(db, t.userId, noran);
    expect(res.proposed).toHaveLength(200);
    expect(res.not_proposed).toHaveLength(200);
    const numbers = res.proposed.map((l) => l.order_number);
    expect(numbers).toEqual([...numbers].sort((x, y) => x - y));
    expect(numbers[0]).toBe(first.order.order_number);
    expect(new Set(numbers)).toEqual(new Set([first.order.order_number, second.order.order_number]));
    expect(res.not_proposed.every((l) => l.order_id === alike.id || l.order_id === alike2.id)).toBe(true);
  }, 120_000);
});

describe("reading only", () => {
  it("writes nothing: row counts and order versions are the same before and after", async () => {
    const { t, storeId } = await business();
    const noran = await insertMedicine(db, t.businessId, { name: "Noran", strength: "20 mg" });
    await createPendingOrder(db, t.userId, storeId, [typedLine("Noran 20 mg", 1), typedLine("Noran 40 mg", 1)], { confirm: true });
    const before = await counts();
    const res = await dbCandidates(db, t.userId, noran);
    expect(res.proposed).toHaveLength(1);
    expect(res.not_proposed).toHaveLength(1);
    expect(await counts()).toEqual(before);
  });

  it("is refused for a user without a business and not granted to anon", async () => {
    const noBiz = await db.query<{ id: string }>(`insert into auth.users (email) values ('nobiz-cand@example.test') returning id`);
    await expect(dbCandidates(db, noBiz.rows[0].id, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(/no_business/);
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await db.exec("set role anon");
    try {
      await expect(db.query(`select public.pending_candidates('00000000-0000-4000-8000-000000000000')`)).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });
});
