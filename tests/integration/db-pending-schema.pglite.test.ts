import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";
import { catalogLine, seedWithDb, typedLine, type Seeded } from "../helpers/orders";
import { createPendingOrder } from "../helpers/pending-db";

// Schema, constraints, triggers and privileges of migration 0004 (pending products), on a real PostgreSQL
// engine (PGlite) with a Supabase-like role setup. Rows are inserted as the table owner here, which
// bypasses Row Level Security, so these tests exercise the constraints and triggers themselves.

let db: PGlite;
let a: Tenant;
let seedA: Seeded;
let confirmedTypedLine: string;
let draftTypedLine: string;

const asA = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", a.userId, fn);

const PUBLIC_FUNCTIONS = [
  "pending_line_register",
  "pending_line_link",
  "pending_price_apply",
  "pending_price_preview",
  "pending_summary",
  "pending_typed_groups",
  "pending_candidates",
  "pending_prices_list",
];

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
  seedA = await seedWithDb(db, a.businessId);
  const confirmed = await createPendingOrder(db, a.userId, seedA.storeId, [typedLine("Noran 20mg cap", 3, "strip"), catalogLine(seedA.pricedId, 1)], { confirm: true });
  confirmedTypedLine = confirmed.order.lines.find((l) => l.product_id === null)!.id;
  const draft = await createPendingOrder(db, a.userId, seedA.storeId, [typedLine("Noran 20mg cap", 2, "strip")]);
  draftTypedLine = draft.lineIds[0];
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("order_lines.typed_name", () => {
  it("exists and is null on every existing line", async () => {
    const res = await db.query<{ n: number }>(`select count(*)::int as n from public.order_lines where typed_name is not null`);
    expect(res.rows[0].n).toBe(0);
    const col = await db.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'order_lines' and column_name = 'typed_name'`,
    );
    expect(col.rows[0].is_nullable).toBe("YES");
  });

  it("is write-once: it cannot change or be cleared, even with the snapshot-edit flag on", async () => {
    await db.query(`update public.order_lines set typed_name = 'First typed text' where id = $1`, [draftTypedLine]);
    await expect(db.query(`update public.order_lines set typed_name = 'Other' where id = $1`, [draftTypedLine])).rejects.toThrow(/typed_name_immutable/);
    await expect(db.query(`update public.order_lines set typed_name = null where id = $1`, [draftTypedLine])).rejects.toThrow(/typed_name_immutable/);
    await db.exec(`begin; select set_config('app.line_snapshot_edit', 'on', true);`);
    await expect(db.query(`update public.order_lines set typed_name = 'Other' where id = $1`, [draftTypedLine])).rejects.toThrow(/typed_name_immutable/);
    await db.exec(`rollback`);
    // restore the draft line for the other tests (the trigger only protects a set value; reset through a new row)
    await db.query(`update public.order_lines set typed_name = 'First typed text' where id = $1`, [draftTypedLine]);
  });

  it("refuses an empty or too long value", async () => {
    await expect(db.query(`update public.order_lines set typed_name = '   ' where id = $1`, [confirmedTypedLine])).rejects.toThrow();
    await expect(db.query(`update public.order_lines set typed_name = $2 where id = $1`, [confirmedTypedLine, "x".repeat(201)])).rejects.toThrow();
  });
});

describe("order_events", () => {
  async function insertEvent(type: string) {
    const order = await db.query<{ id: string; version: number }>(`select id, version from public.orders where business_id = $1 limit 1`, [a.businessId]);
    return db.query(
      `insert into public.order_events (business_id, order_id, event_type, order_version, detail) values ($1, $2, $3, $4, '{}'::jsonb)`,
      [a.businessId, order.rows[0].id, type, order.rows[0].version],
    );
  }

  it("accepts linked and price_filled and still accepts the four old kinds", async () => {
    for (const type of ["created", "confirmed", "edited", "cancelled", "linked", "price_filled"]) {
      await expect(insertEvent(type), type).resolves.toBeDefined();
    }
  });

  it("rejects any other kind", async () => {
    await expect(insertEvent("deleted")).rejects.toThrow();
    await expect(insertEvent("")).rejects.toThrow();
  });
});

describe("pending_requests", () => {
  it("exists with RLS on and no privileges for signed-in users or anon", async () => {
    const rls = await db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where relname = 'pending_requests' and relkind = 'r'`);
    expect(rls.rows[0].relrowsecurity).toBe(true);
    for (const role of ["authenticated", "anon"]) {
      const res = await db.query<{ any: boolean }>(`select has_any_column_privilege('${role}', 'public.pending_requests', 'select, insert, update, references') as any`);
      expect(res.rows[0].any, role).toBe(false);
    }
    await expect(asA(() => db.query(`select * from public.pending_requests`))).rejects.toThrow();
    await expect(asA(() => db.query(`insert into public.pending_requests (request_id, kind, result) values ($1, 'link', '{}')`, [randomUUID()]))).rejects.toThrow();
  });

  it("refuses an update, and a delete unless the role is service_role", async () => {
    const requestId = randomUUID();
    await db.query(`insert into public.pending_requests (business_id, request_id, kind, result) values ($1, $2, 'link', '{}'::jsonb)`, [a.businessId, requestId]);
    await expect(db.query(`update public.pending_requests set kind = 'register' where request_id = $1`, [requestId])).rejects.toThrow(/pending_requests_append_only/);
    await expect(db.query(`delete from public.pending_requests where request_id = $1`, [requestId])).rejects.toThrow(/pending_requests_append_only/);
    // On Supabase the service role has these privileges by default; this test database does not.
    await db.exec(`grant select, delete on public.pending_requests to service_role`);
    await withRole(db, "service_role", null, async () => {
      await db.query(`delete from public.pending_requests where request_id = $1`, [requestId]);
    });
    const left = await db.query<{ n: number }>(`select count(*)::int as n from public.pending_requests where request_id = $1`, [requestId]);
    expect(left.rows[0].n).toBe(0);
  });

  it("allows only the three known kinds", async () => {
    await expect(db.query(`insert into public.pending_requests (business_id, request_id, kind, result) values ($1, $2, 'other', '{}'::jsonb)`, [a.businessId, randomUUID()])).rejects.toThrow();
  });

  it("is reported by rls_audit with RLS on and a business_id", async () => {
    const rows = await withRole(db, "service_role", null, async () => (await db.query<{ table_name: string; rls_enabled: boolean; has_business_id: boolean }>(`select * from public.rls_audit()`)).rows);
    const row = rows.find((r) => r.table_name === "pending_requests");
    expect(row).toBeDefined();
    expect(row!.rls_enabled).toBe(true);
    expect(row!.has_business_id).toBe(true);
  });
});

describe("indexes", () => {
  it("has the three partial indexes", async () => {
    const res = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public' and indexname in
        ('order_lines_pending_typed_idx', 'order_lines_waiting_price_idx', 'products_unpriced_idx') order by indexname`,
    );
    expect(res.rows.map((r) => r.indexname)).toEqual(["order_lines_pending_typed_idx", "order_lines_waiting_price_idx", "products_unpriced_idx"]);
  });
});

describe("functions and privileges", () => {
  it("has the eight public functions, executable by signed-in users and not by anon", async () => {
    for (const name of PUBLIC_FUNCTIONS) {
      const res = await db.query<{ oid: number; auth: boolean; anon: boolean }>(
        `select p.oid::int as oid, has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`,
        [name],
      );
      expect(res.rows.length, name).toBeGreaterThanOrEqual(1);
      for (const row of res.rows) {
        expect(row.auth, `${name} for authenticated`).toBe(true);
        expect(row.anon, `${name} for anon`).toBe(false);
      }
    }
  });

  it("keeps the internal helper pending_link_line out of reach of signed-in users", async () => {
    const res = await db.query<{ auth: boolean; anon: boolean }>(
      `select has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'pending_link_line'`,
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].auth).toBe(false);
    expect(res.rows[0].anon).toBe(false);
  });

  it("makes the write functions SECURITY DEFINER and the reads SECURITY INVOKER", async () => {
    const res = await db.query<{ proname: string; prosecdef: boolean }>(
      `select p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any ($1::text[])`,
      [PUBLIC_FUNCTIONS],
    );
    const byName = new Map(res.rows.map((r) => [r.proname, r.prosecdef]));
    for (const name of ["pending_line_register", "pending_line_link", "pending_price_apply"]) expect(byName.get(name), name).toBe(true);
    for (const name of ["pending_price_preview", "pending_summary", "pending_typed_groups", "pending_candidates", "pending_prices_list"]) expect(byName.get(name), name).toBe(false);
  });

  it("does not let a signed-in user write the order tables directly", async () => {
    await expect(asA(() => db.query(`update public.order_lines set typed_name = 'x' where id = $1`, [confirmedTypedLine]))).rejects.toThrow();
    await expect(asA(() => db.query(`insert into public.order_events (order_id, event_type, order_version) values ($1, 'linked', 1)`, [randomUUID()]))).rejects.toThrow();
  });
});

describe("order_to_json and the Module 003 functions", () => {
  it("returns a typed_name key (null) for every line", async () => {
    const orders = await db.query<{ id: string }>(`select id from public.orders where business_id = $1`, [a.businessId]);
    for (const { id } of orders.rows) {
      const res = await asA(() => db.query<{ r: { lines: Array<Record<string, unknown>> } }>(`select public.order_get($1) as r`, [id]));
      for (const line of res.rows[0].r.lines) {
        expect(Object.keys(line), "typed_name key").toContain("typed_name");
      }
    }
  });

  it("keeps order_save, order_confirm and order_cancel working", async () => {
    const draft = await createPendingOrder(db, a.userId, seedA.storeId, [typedLine("Smoke test", 1, "strip")]);
    const confirmed = await createPendingOrder(db, a.userId, seedA.storeId, [typedLine("Smoke test 2", 1, "strip")], { confirm: true });
    expect(draft.order.status).toBe("draft");
    expect(confirmed.order.status).toBe("confirmed");
    const cancelled = await asA(() => db.query<{ r: { cancelled?: boolean } }>(`select public.order_cancel($1, $2, $3, $4) as r`, [confirmed.id, randomUUID(), confirmed.order.version, "smoke"]));
    expect(cancelled.rows[0].r.cancelled).toBe(true);
  });
});

describe("re-running the migration", () => {
  it("can be applied a second time without an error and without changing data", async () => {
    const before = await db.query<{ lines: number; events: number; products: number }>(
      `select (select count(*) from public.order_lines)::int as lines, (select count(*) from public.order_events)::int as events, (select count(*) from public.products)::int as products`,
    );
    const sql = readFileSync(path.resolve("supabase/migrations/0004_pending_products.sql"), "utf8");
    await db.exec(sql);
    await db.exec(sql);
    const after = await db.query<{ lines: number; events: number; products: number }>(
      `select (select count(*) from public.order_lines)::int as lines, (select count(*) from public.order_events)::int as events, (select count(*) from public.products)::int as products`,
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    // the event check is still the new one
    await expect(
      db.query(`insert into public.order_events (business_id, order_id, event_type, order_version) select business_id, id, 'linked', version from public.orders limit 1`),
    ).resolves.toBeDefined();
  });
});
