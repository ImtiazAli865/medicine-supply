import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../helpers/pglite";

// Security review (Module 011, T035): after every migration in the folder, each table of the public schema has row level security
// switched on, and each table that holds a business's data has at least one policy. A table is allowed to have no business_id only
// when it is on the list below, with the reason; a new table that is neither protected nor listed fails this test.

/** Public tables without a business_id column, each with the reason it is not a business's data. */
const WITHOUT_BUSINESS_ID: Record<string, string> = {
  businesses: "the business itself: its row is read through the member's own business only",
};

/**
 * Tables of a business that have row level security on but no policy, each with the reason. They are reached only through the
 * database functions (which run with their own rights); the signed-in user and the anonymous visitor have no right on them at all.
 */
const FUNCTION_ONLY: Record<string, string> = {
  order_counters: "the next order number of a business, moved only by the order create function",
  invoice_counters: "the next invoice number of a business, moved only by the invoice issue function",
  pending_requests: "the request ids of pending-product writes, kept only by the pending functions",
};

let db: PGlite;
let tables: Array<{ table_name: string; rls_enabled: boolean; has_business_id: boolean; policies: number }> = [];

beforeAll(async () => {
  db = await createTestDb();
  const result = await db.query<{ table_name: string; rls_enabled: boolean; has_business_id: boolean; policies: string }>(`
    select c.relname::text as table_name,
           c.relrowsecurity as rls_enabled,
           exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'business_id' and not a.attisdropped) as has_business_id,
           (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)::text as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname`);
  tables = result.rows.map((r) => ({ ...r, policies: Number(r.policies) }));
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("row level security of every table, after every migration", () => {
  it("finds the tables of the app", () => {
    expect(tables.length).toBeGreaterThan(15);
    const names = tables.map((t) => t.table_name);
    for (const expected of ["orders", "order_lines", "stores", "products", "invoices", "ledger_entries"]) expect(names).toContain(expected);
  });

  it("has row level security switched on for every table of the public schema, without exception", () => {
    expect(tables.filter((t) => !t.rls_enabled).map((t) => t.table_name)).toEqual([]);
  });

  it("has at least one policy on every table that holds a business's data, except the listed function-only tables", () => {
    const withoutPolicy = tables.filter((t) => t.has_business_id && t.policies === 0).map((t) => t.table_name);
    expect(withoutPolicy.filter((name) => !(name in FUNCTION_ONLY)), "a business table with no policy that is not on the list").toEqual([]);
    for (const [name, reason] of Object.entries(FUNCTION_ONLY)) {
      expect(withoutPolicy, `${name} is listed but has a policy or no business_id`).toContain(name);
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  it("gives the signed-in user and the anonymous visitor no right at all on a function-only table", async () => {
    for (const name of Object.keys(FUNCTION_ONLY)) {
      for (const role of ["anon", "authenticated"]) {
        for (const right of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          const r = await db.query<{ allowed: boolean }>(`select has_table_privilege($1, $2, $3) as allowed`, [role, `public.${name}`, right]);
          expect(r.rows[0]!.allowed, `${role} ${right} on ${name}`).toBe(false);
        }
      }
    }
  });

  it("gives the anonymous visitor no right on any table of a business", async () => {
    const exposed: string[] = [];
    for (const t of tables.filter((x) => x.has_business_id)) {
      for (const right of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const r = await db.query<{ allowed: boolean }>(`select has_table_privilege('anon', $1, $2) as allowed`, [`public.${t.table_name}`, right]);
        if (r.rows[0]!.allowed) exposed.push(`${t.table_name}:${right}`);
      }
    }
    expect(exposed).toEqual([]);
  });

  it("allows a table without a business_id only when it is on the list with a reason, and keeps that list true", () => {
    const without = tables.filter((t) => !t.has_business_id).map((t) => t.table_name);
    const unlisted = without.filter((name) => !(name in WITHOUT_BUSINESS_ID));
    expect(unlisted, "a table without business_id that is not on the list").toEqual([]);
    for (const [name, reason] of Object.entries(WITHOUT_BUSINESS_ID)) {
      expect(without, `${name} is listed but is not a table without a business_id`).toContain(name);
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  it("keeps every table without a business_id readable only through a policy too", () => {
    for (const t of tables.filter((x) => !x.has_business_id)) expect(t.policies, t.table_name).toBeGreaterThan(0);
  });

  it("lists the tables it checked (for the security review)", () => {
    const lines = tables.map((t) => `${t.table_name.padEnd(28)} rls=${t.rls_enabled ? "on " : "OFF"} business_id=${t.has_business_id ? "yes" : "no "} policies=${t.policies}`);
    console.info(`Public tables (${tables.length}):\n${lines.join("\n")}`);
    expect(lines.length).toBe(tables.length);
  });
});
