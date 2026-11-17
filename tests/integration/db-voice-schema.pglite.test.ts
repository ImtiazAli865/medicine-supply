import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertStore } from "../helpers/pending-db";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";

// Schema, constraints, guards and privileges of migration 0009 (voice orders), on a real PostgreSQL engine (PGlite)
// with a Supabase-like role setup. Rows are inserted as the table owner here, which bypasses Row Level Security, so
// these tests exercise the constraints, triggers and grants themselves.

let db: PGlite;
let a: Tenant;
let storeA: string;

const FUNCTIONS = [
  "voice_parse_allow()",
  "voice_diag_add(text, text, integer, integer, integer, integer, text)",
  "voice_diag_list(integer, integer)",
  "voice_match_products(jsonb)",
  "voice_match_stores(text)",
  "order_save(uuid, uuid, integer, uuid, text, jsonb, text, text)",
];

async function insertOrder(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  const row: Record<string, unknown> = { id, business_id: a.businessId, store_id: storeA, order_number: Math.floor(Math.random() * 1e9) + 1, ...overrides };
  const cols = Object.keys(row);
  await db.query(
    `insert into public.orders (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    cols.map((c) => row[c]),
  );
  return id;
}

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "voice-schema-a");
  storeA = await insertStore(db, a.businessId, "Voice schema store");
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("orders.spoken_text", () => {
  it("exists, is empty for a manual order, and is allowed only for a voice order of 1 to 2,000 characters", async () => {
    const column = await db.query<{ is_nullable: string; data_type: string }>(
      `select is_nullable, data_type from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'spoken_text'`,
    );
    expect(column.rows).toEqual([{ is_nullable: "YES", data_type: "text" }]);

    await expect(insertOrder({ source: "manual", spoken_text: "Panadol 20 strips" })).rejects.toThrow(/check|violates/i);
    await expect(insertOrder({ source: "voice", spoken_text: "" })).rejects.toThrow(/check|violates/i);
    await expect(insertOrder({ source: "voice", spoken_text: "   " })).rejects.toThrow(/check|violates/i);
    await expect(insertOrder({ source: "voice", spoken_text: "x".repeat(2001) })).rejects.toThrow(/check|violates/i);
    const ok = await insertOrder({ source: "voice", spoken_text: "x".repeat(2000) });
    expect(ok).toBeTruthy();
    expect(await insertOrder({ source: "manual" })).toBeTruthy();
  });

  it("is immutable, like the source", async () => {
    const id = await insertOrder({ source: "voice", spoken_text: "Brufen 10 box" });
    await expect(db.query(`update public.orders set spoken_text = 'changed' where id = $1`, [id])).rejects.toThrow(/immutable/i);
    await expect(db.query(`update public.orders set spoken_text = null where id = $1`, [id])).rejects.toThrow(/immutable/i);
    await expect(db.query(`update public.orders set source = 'manual' where id = $1`, [id])).rejects.toThrow(/immutable/i);
    // other updates still work
    await db.query(`update public.orders set notes = 'a note' where id = $1`, [id]);
    const row = await db.query<{ notes: string; spoken_text: string }>(`select notes, spoken_text from public.orders where id = $1`, [id]);
    expect(row.rows[0]).toEqual({ notes: "a note", spoken_text: "Brufen 10 box" });
  });
});

describe("the new tables", () => {
  it("have Row Level Security on and a business id, and appear in rls_audit", async () => {
    const rows = await withRole(db, "service_role", null, async () =>
      (await db.query<{ table_name: string; rls_enabled: boolean; has_business_id: boolean }>(`select * from public.rls_audit()`)).rows,
    );
    for (const table of ["voice_diagnostics", "voice_parse_attempts"]) {
      expect(rows.find((r) => r.table_name === table), table).toMatchObject({ rls_enabled: true, has_business_id: true });
    }
    expect(rows.every((r) => r.rls_enabled)).toBe(true);
  });

  it("give signed-in users no write grant, and read access only to the diagnostic log", async () => {
    const priv = async (table: string, p: string) =>
      (await db.query<{ ok: boolean }>(`select has_table_privilege('authenticated', $1, $2) as ok`, [`public.${table}`, p])).rows[0].ok;
    for (const p of ["insert", "update", "delete", "truncate"]) {
      expect(await priv("voice_diagnostics", p), `voice_diagnostics ${p}`).toBe(false);
      expect(await priv("voice_parse_attempts", p), `voice_parse_attempts ${p}`).toBe(false);
    }
    expect(await priv("voice_diagnostics", "select")).toBe(true);
    expect(await priv("voice_parse_attempts", "select")).toBe(false);
    const anon = (await db.query<{ ok: boolean }>(`select has_table_privilege('anon', 'public.voice_diagnostics', 'select') as ok`)).rows[0].ok;
    expect(anon).toBe(false);
  });

  it("refuse update and delete of a diagnostic record for a signed-in user, and have a select policy for the owner's business only", async () => {
    await db.query(
      `insert into public.voice_diagnostics (business_id, kind, parser, message) values ($1, 'ai_busy', 'ai', 'Service busy')`,
      [a.businessId],
    );
    await withRole(db, "authenticated", a.userId, async () => {
      await expect(db.query(`update public.voice_diagnostics set message = 'x'`)).rejects.toThrow(/permission denied|immutable|append/i);
      await expect(db.query(`delete from public.voice_diagnostics`)).rejects.toThrow(/permission denied|immutable|append/i);
    });
    const policies = await db.query<{ cmd: string }>(`select cmd from pg_policies where schemaname = 'public' and tablename = 'voice_diagnostics'`);
    expect(policies.rows.map((r) => r.cmd)).toEqual(["SELECT"]);
  });

  it("have no price, MRP, cost, balance or transcript column", async () => {
    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name in ('voice_diagnostics', 'voice_parse_attempts')`,
    );
    for (const { column_name } of cols.rows) expect(column_name).not.toMatch(/purchase|mrp|cost|margin|profit|price|balance|transcript$|^text$/i);
    expect(cols.rows.map((r) => r.column_name)).toContain("transcript_length");
  });
});

describe("the functions and their grants", () => {
  it("exist, can be executed by signed-in users and not by anon", async () => {
    for (const fn of FUNCTIONS) {
      const row = await db.query<{ auth: boolean; anon: boolean }>(
        `select has_function_privilege('authenticated', $1::regprocedure, 'execute') as auth,
                has_function_privilege('anon', $1::regprocedure, 'execute') as anon`,
        [`public.${fn}`],
      );
      expect(row.rows[0], fn).toEqual({ auth: true, anon: false });
    }
  });

  it("have replaced the six-argument order_save with the eight-argument one", async () => {
    const rows = await db.query<{ args: string }>(`select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'order_save'`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].args).toMatch(/p_source text/);
    expect(rows.rows[0].args).toMatch(/p_spoken_text text/);
  });

  it("return no price, MRP or cost column from the match functions", async () => {
    const def = await db.query<{ cols: string }>(
      `select string_agg(pg_get_function_result(p.oid), ' ') as cols from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('voice_match_products', 'voice_match_stores')`,
    );
    expect(def.rows[0].cols).not.toMatch(/purchase|mrp|cost|margin|profit|price|balance/i);
  });
});
