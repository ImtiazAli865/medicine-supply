import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";
import { insertMedicine } from "../helpers/pending-db";

// Schema, constraints, triggers and privileges of migration 0006 (market list and purchases), on a real
// PostgreSQL engine (PGlite) with a Supabase-like role setup. Rows are inserted as the table owner here, which
// bypasses Row Level Security, so these tests exercise the constraints and triggers themselves.

let db: PGlite;
let a: Tenant;
let productId: string;
let entryId: string;

const asA = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", a.userId, fn);

const PUBLIC_FUNCTIONS = [
  "purchase_record",
  "purchase_void",
  "purchase_entries_list",
  "market_list",
  "market_summary",
  "market_rows",
  "purchase_entry_to_json",
];

async function insertEntry(overrides: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id: randomUUID(),
    business_id: a.businessId,
    product_id: productId,
    unit: "strip",
    purchase_date: "2026-11-13",
    quantity: 5,
    ...overrides,
  };
  const cols = Object.keys(row);
  await db.query(
    `insert into public.purchase_entries (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    cols.map((c) => row[c]),
  );
  return row.id as string;
}

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
  productId = await insertMedicine(db, a.businessId, { name: "Panadol 500mg" });
  entryId = await insertEntry();
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("purchase_entries constraints", () => {
  it("accepts a valid entry with only the required fields (cost stays null, never 0)", async () => {
    const id = await insertEntry();
    const row = await db.query<{ unit_cost: string | null }>(`select unit_cost from public.purchase_entries where id = $1`, [id]);
    expect(row.rows[0].unit_cost).toBeNull();
  });

  it.each([
    ["quantity 0", { quantity: 0 }],
    ["quantity 100001", { quantity: 100001 }],
    ["a negative cost", { unit_cost: "-1" }],
    ["an empty unit", { unit: "   " }],
    ["a unit over 50 characters", { unit: "x".repeat(51) }],
    ["a supplier over 200 characters", { supplier_name: "x".repeat(201) }],
    ["a reference over 100 characters", { reference: "x".repeat(101) }],
    ["a date before 2000", { purchase_date: "1999-12-31" }],
  ])("refuses %s", async (_label, overrides) => {
    await expect(insertEntry(overrides)).rejects.toThrow();
  });

  it("refuses a fractional quantity and a cost with three decimals by rounding or type (never stores them as typed)", async () => {
    await expect(insertEntry({ quantity: 1.5 })).rejects.toThrow();
    const id = await insertEntry({ unit_cost: "12.345" });
    const row = await db.query<{ unit_cost: string }>(`select unit_cost::text as unit_cost from public.purchase_entries where id = $1`, [id]);
    // numeric(12,2) rounds; the function refuses three decimals before it gets here (see db-purchase-record).
    expect(row.rows[0].unit_cost).toBe("12.35");
  });

  it("refuses a medicine of another business (composite foreign key)", async () => {
    const b = await createTenant(db, "b");
    const otherProduct = await insertMedicine(db, b.businessId, { name: "Other" });
    await expect(insertEntry({ product_id: otherProduct })).rejects.toThrow();
  });
});

describe("purchase_entries and purchase_voids are append-only", () => {
  it("refuses an update and a delete of an entry, whoever asks", async () => {
    await expect(db.query(`update public.purchase_entries set quantity = 9 where id = $1`, [entryId])).rejects.toThrow(/purchase_entries_append_only/);
    await expect(db.query(`delete from public.purchase_entries where id = $1`, [entryId])).rejects.toThrow(/purchase_entries_append_only/);
  });

  it("accepts one void per entry and refuses a second, an empty reason and a too long reason", async () => {
    await db.query(`insert into public.purchase_voids (entry_id, business_id, reason) values ($1, $2, 'typed wrongly')`, [entryId, a.businessId]);
    await expect(db.query(`insert into public.purchase_voids (entry_id, business_id, reason) values ($1, $2, 'again')`, [entryId, a.businessId])).rejects.toThrow();
    const other = await insertEntry();
    await expect(db.query(`insert into public.purchase_voids (entry_id, business_id, reason) values ($1, $2, '   ')`, [other, a.businessId])).rejects.toThrow();
    await expect(db.query(`insert into public.purchase_voids (entry_id, business_id, reason) values ($1, $2, $3)`, [other, a.businessId, "x".repeat(501)])).rejects.toThrow();
  });

  it("refuses an update and a delete of a void", async () => {
    await expect(db.query(`update public.purchase_voids set reason = 'changed' where entry_id = $1`, [entryId])).rejects.toThrow(/purchase_voids_append_only/);
    await expect(db.query(`delete from public.purchase_voids where entry_id = $1`, [entryId])).rejects.toThrow(/purchase_voids_append_only/);
  });

  it("lets only the service role delete (test clean-up and operations, never the app)", async () => {
    const id = await insertEntry();
    // On Supabase the service role has these privileges by default; this test database does not.
    await db.exec(`grant select, delete on public.purchase_entries, public.purchase_voids to service_role`);
    await withRole(db, "service_role", null, async () => {
      await db.query(`delete from public.purchase_entries where id = $1`, [id]);
    });
    const left = await db.query<{ n: number }>(`select count(*)::int as n from public.purchase_entries where id = $1`, [id]);
    expect(left.rows[0].n).toBe(0);
  });
});

describe("privileges and Row Level Security", () => {
  it("has RLS on both tables, select only for signed-in users, nothing for anon", async () => {
    for (const table of ["purchase_entries", "purchase_voids"]) {
      const rls = await db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where relname = '${table}' and relkind = 'r'`);
      expect(rls.rows[0].relrowsecurity, table).toBe(true);
      const sel = await db.query<{ ok: boolean }>(`select has_table_privilege('authenticated', 'public.${table}', 'select') as ok`);
      expect(sel.rows[0].ok, `${table} select`).toBe(true);
      for (const priv of ["insert", "update", "delete"]) {
        const res = await db.query<{ ok: boolean }>(`select has_table_privilege('authenticated', 'public.${table}', '${priv}') as ok`);
        expect(res.rows[0].ok, `${table} ${priv}`).toBe(false);
      }
      const anon = await db.query<{ ok: boolean }>(`select has_any_column_privilege('anon', 'public.${table}', 'select, insert, update, references') as ok`);
      expect(anon.rows[0].ok, `${table} anon`).toBe(false);
    }
  });

  it("refuses a direct write by a signed-in user", async () => {
    await expect(
      asA(() => db.query(
        `insert into public.purchase_entries (id, product_id, unit, purchase_date, quantity) values ($1, $2, 'strip', '2026-11-13', 1)`,
        [randomUUID(), productId],
      )),
    ).rejects.toThrow();
  });

  it("lets a signed-in user read only their own entries", async () => {
    const mine = await asA(() => db.query<{ n: number }>(`select count(*)::int as n from public.purchase_entries`));
    expect(mine.rows[0].n).toBeGreaterThan(0);
    const b = await createTenant(db, "reader-b");
    const theirs = await withRole(db, "authenticated", b.userId, () => db.query<{ n: number }>(`select count(*)::int as n from public.purchase_entries`));
    expect(theirs.rows[0].n).toBe(0);
  });

  it("is reported by rls_audit with RLS on and a business_id", async () => {
    const rows = await withRole(db, "service_role", null, async () => (await db.query<{ table_name: string; rls_enabled: boolean; has_business_id: boolean }>(`select * from public.rls_audit()`)).rows);
    for (const table of ["purchase_entries", "purchase_voids"]) {
      const row = rows.find((r) => r.table_name === table);
      expect(row, table).toBeDefined();
      expect(row!.rls_enabled).toBe(true);
      expect(row!.has_business_id).toBe(true);
    }
  });

  it("makes the seven functions executable by signed-in users and not by anon", async () => {
    for (const fn of PUBLIC_FUNCTIONS) {
      const res = await db.query<{ authed: boolean; anon: boolean }>(
        `select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) as authed,
                bool_or(has_function_privilege('anon', p.oid, 'execute')) as anon
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`,
        [fn],
      );
      expect(res.rows[0].authed, `${fn} authenticated`).toBe(true);
      expect(res.rows[0].anon, `${fn} anon`).toBe(false);
    }
  });
});

describe("indexes", () => {
  it("has the market indexes", async () => {
    const res = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public' and indexname in ('orders_market_idx', 'purchase_entries_day_idx') order by indexname`,
    );
    expect(res.rows.map((r) => r.indexname)).toEqual(["orders_market_idx", "purchase_entries_day_idx"]);
  });
});
