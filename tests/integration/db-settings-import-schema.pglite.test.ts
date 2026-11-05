import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";

// Module 002 schema: business_settings, imports, products.import_id, privileges.
// Runs the real migrations on a real PostgreSQL engine (PGlite).

let db: PGlite;
let a: Tenant;
let b: Tenant;

const asA = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", a.userId, fn);

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
  b = await createTenant(db, "b");
});

afterAll(async () => {
  await db.close();
});

async function insertImport(businessId: string, id = randomUUID()) {
  await db.query(
    `insert into public.imports (id, business_id, file_name, file_kind, submitted_rows, created_count,
       created_similar_count, skipped_count, status_counts, skipped, fingerprint)
     values ($1,$2,'f.csv','csv',0,0,0,0,'{}'::jsonb,'[]'::jsonb,'x')`,
    [id, businessId],
  );
  return id;
}

describe("business_settings", () => {
  it("is created with defaults for every new business (trigger)", async () => {
    const r = await db.query<Record<string, unknown>>(`select * from public.business_settings where business_id = $1`, [a.businessId]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      phone: null,
      address: null,
      thermal_paper_mm: 80,
      account_summary_default: false,
      details_saved: false,
      checklist_dismissed: false,
      version: 1,
    });
  });

  it("backfills a row for a business that existed before the migration", async () => {
    // Simulate a pre-0002 business: insert one, delete its settings row, re-run the backfill statement.
    const biz = await db.query<{ id: string }>(`insert into public.businesses (name) values ('old') returning id`);
    await db.query(`delete from public.business_settings where business_id = $1`, [biz.rows[0].id]);
    // The migration's backfill is this idempotent statement; it must also be safe to run again.
    const backfill = `insert into public.business_settings (business_id)
                      select b.id from public.businesses b
                      where not exists (select 1 from public.business_settings s where s.business_id = b.id)`;
    await db.exec(backfill);
    await db.exec(backfill);
    const r = await db.query(`select 1 from public.business_settings where business_id = $1`, [biz.rows[0].id]);
    expect(r.rows).toHaveLength(1);
  });

  it("refuses paper widths outside 40-120", async () => {
    for (const bad of [39, 121]) {
      await expect(
        db.query(`update public.business_settings set thermal_paper_mm = $1 where business_id = $2`, [bad, a.businessId]),
      ).rejects.toThrow(/check/i);
    }
  });

  it("does not bump version when only checklist_dismissed changes, but updates updated_at", async () => {
    const before = await db.query<{ version: number; updated_at: string }>(
      `select version, updated_at::text from public.business_settings where business_id = $1`, [a.businessId]);
    await new Promise((res) => setTimeout(res, 20));
    await asA(() => db.query(`update public.business_settings set checklist_dismissed = true where business_id = $1`, [a.businessId]));
    const after = await db.query<{ version: number; updated_at: string; checklist_dismissed: boolean }>(
      `select version, updated_at::text, checklist_dismissed from public.business_settings where business_id = $1`, [a.businessId]);
    expect(after.rows[0].version).toBe(before.rows[0].version);
    expect(after.rows[0].updated_at).not.toBe(before.rows[0].updated_at);
    expect(after.rows[0].checklist_dismissed).toBe(true);
    await db.query(`update public.business_settings set checklist_dismissed = false where business_id = $1`, [a.businessId]);
  });

  it("lets the owner update only checklist_dismissed; no insert, no delete, no other column", async () => {
    await expect(
      asA(() => db.query(`update public.business_settings set phone = '123' where business_id = $1`, [a.businessId])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asA(() => db.query(`update public.business_settings set thermal_paper_mm = 58 where business_id = $1`, [a.businessId])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asA(() => db.query(`insert into public.business_settings (business_id) values ($1)`, [a.businessId])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asA(() => db.query(`delete from public.business_settings where business_id = $1`, [a.businessId])),
    ).rejects.toThrow(/permission denied/);
  });

  it("cannot update the businesses table directly", async () => {
    await expect(
      asA(() => db.query(`update public.businesses set name = 'hacked' where id = $1`, [a.businessId])),
    ).rejects.toThrow(/permission denied/);
  });

  it("anon has no access to the new tables", async () => {
    await expect(withRole(db, "anon", null, () => db.query(`select * from public.business_settings`))).rejects.toThrow(/permission denied/);
    await expect(withRole(db, "anon", null, () => db.query(`select * from public.imports`))).rejects.toThrow(/permission denied/);
  });
});

describe("imports and products.import_id", () => {
  it("has RLS enabled on both new tables", async () => {
    const rows = await withRole(db, "service_role", null, async () => {
      const res = await db.query<{ table_name: string; rls_enabled: boolean; has_business_id: boolean }>(`select * from public.rls_audit()`);
      return res.rows;
    });
    for (const t of ["business_settings", "imports"]) {
      const row = rows.find((r) => r.table_name === t);
      expect(row, `${t} must exist`).toBeDefined();
      expect(row!.rls_enabled).toBe(true);
      expect(row!.has_business_id).toBe(true);
    }
  });

  it("products.import_id exists and is nullable", async () => {
    const r = await db.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns where table_schema='public' and table_name='products' and column_name='import_id'`);
    expect(r.rows[0]?.is_nullable).toBe("YES");
  });

  it("a product cannot point at another business's import", async () => {
    const importB = await insertImport(b.businessId);
    await expect(
      db.query(
        `insert into public.products (id, business_id, name, unit, import_id) values ($1, $2, 'X', 'strip', $3)`,
        [randomUUID(), a.businessId, importB],
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    // and it can point at its own
    const importA = await insertImport(a.businessId);
    await db.query(`insert into public.products (id, business_id, name, unit, import_id) values ($1, $2, 'Own', 'strip', $3)`,
      [randomUUID(), a.businessId, importA]);
  });

  it("owner can insert and read own imports but not update or delete them", async () => {
    const id = randomUUID();
    await asA(() => db.query(
      `insert into public.imports (id, file_name, file_kind, submitted_rows, created_count, created_similar_count, skipped_count, status_counts, skipped, fingerprint)
       values ($1,'f.csv','csv',1,1,0,0,'{}'::jsonb,'[]'::jsonb,'x')`, [id]));
    const own = await asA(() => db.query(`select id from public.imports where id = $1`, [id]));
    expect(own.rows).toHaveLength(1);
    await expect(asA(() => db.query(`update public.imports set file_name = 'y' where id = $1`, [id]))).rejects.toThrow(/permission denied/);
    await expect(asA(() => db.query(`delete from public.imports where id = $1`, [id]))).rejects.toThrow(/permission denied/);
  });

  it("owner cannot insert an import row for another business", async () => {
    await expect(asA(() => db.query(
      `insert into public.imports (id, business_id, file_name, file_kind, submitted_rows, created_count, created_similar_count, skipped_count, status_counts, skipped, fingerprint)
       values ($1,$2,'f.csv','csv',1,1,0,0,'{}'::jsonb,'[]'::jsonb,'x')`, [randomUUID(), b.businessId]))).rejects.toThrow(/row-level security|violates/i);
  });
});
