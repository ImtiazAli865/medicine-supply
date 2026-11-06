import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";

// Isolation of settings, imports and imported products between two businesses, on a real PostgreSQL
// engine (PGlite) with the `authenticated` role. The same checks run against Supabase in
// rls-settings-import.test.ts.

let db: PGlite;
let a: Tenant;
let b: Tenant;
let importB: string;

const asA = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", a.userId, fn);
const asB = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", b.userId, fn);

const save = (version: number, name: string, paper = 80) =>
  `select public.save_business_settings(${version}, '${name}', ' 0300 ', '', ${paper}, true) as r`;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
  b = await createTenant(db, "b");
  importB = randomUUID();
  await db.query(
    `insert into public.imports (id, business_id, file_name, file_kind, submitted_rows, created_count, created_similar_count, skipped_count, status_counts, skipped, fingerprint)
     values ($1,$2,'b.csv','csv',0,0,0,0,'{}'::jsonb,'[]'::jsonb,'fp')`, [importB, b.businessId]);
  await db.query(`insert into public.products (id, business_id, name, unit, import_id) values ($1,$2,'B med','strip',$3)`, [randomUUID(), b.businessId, importB]);
});
afterAll(async () => {
  await db.close();
});

describe("settings isolation", () => {
  it("each business sees only its own settings row", async () => {
    const seenA = await asA(() => db.query<{ business_id: string }>(`select business_id from public.business_settings`));
    expect(seenA.rows.map((r) => r.business_id)).toEqual([a.businessId]);
    const seenB = await asB(() => db.query<{ business_id: string }>(`select business_id from public.business_settings`));
    expect(seenB.rows.map((r) => r.business_id)).toEqual([b.businessId]);
  });

  it("save_business_settings changes only the caller's business and settings", async () => {
    const res = await asA(() => db.query<{ r: { saved: boolean; settings: Record<string, unknown> } }>(save(1, "Alpha Pharma", 58)));
    expect(res.rows[0].r.saved).toBe(true);
    expect(res.rows[0].r.settings).toMatchObject({ name: "Alpha Pharma", phone: "0300", address: null, thermal_paper_mm: 58, account_summary_default: true, details_saved: true, version: 2 });
    const bRow = await db.query(`select b.name, s.version, s.details_saved, s.thermal_paper_mm from public.businesses b join public.business_settings s on s.business_id = b.id where b.id = $1`, [b.businessId]);
    expect(bRow.rows[0]).toMatchObject({ name: "b business", version: 1, details_saved: false, thermal_paper_mm: 80 });
  });

  it("returns a version conflict with the current settings instead of overwriting", async () => {
    const res = await asA(() => db.query<{ r: { saved: boolean; reason: string; current: Record<string, unknown> } }>(save(1, "Stale Name")));
    expect(res.rows[0].r).toMatchObject({ saved: false, reason: "version_conflict", current: { name: "Alpha Pharma", version: 2 } });
    const name = await db.query<{ name: string }>(`select name from public.businesses where id = $1`, [a.businessId]);
    expect(name.rows[0].name).toBe("Alpha Pharma");
  });

  it("refuses bad values: paper width outside 40-120 and an empty name, leaving settings unchanged", async () => {
    await expect(asA(() => db.query(save(2, "Alpha Pharma", 39)))).rejects.toThrow(/check/i);
    await expect(asA(() => db.query(save(2, "   ")))).rejects.toThrow(/check/i);
    const row = await db.query<{ version: number; thermal_paper_mm: number }>(`select version, thermal_paper_mm from public.business_settings where business_id = $1`, [a.businessId]);
    expect(row.rows[0]).toMatchObject({ version: 2, thermal_paper_mm: 58 });
  });

  it("an account without a business is refused", async () => {
    const orphan = randomUUID();
    await db.query(`insert into auth.users (id, email) values ($1, 'o@example.test')`, [orphan]);
    await expect(withRole(db, "authenticated", orphan, () => db.query(save(1, "X")))).rejects.toThrow(/no_business/);
  });

  it("A cannot dismiss B's checklist (the update matches no row) and B's state is unchanged", async () => {
    const res = await asA(() => db.query(`update public.business_settings set checklist_dismissed = true where business_id = $1`, [b.businessId]));
    expect(res.affectedRows).toBe(0);
    const row = await db.query<{ checklist_dismissed: boolean }>(`select checklist_dismissed from public.business_settings where business_id = $1`, [b.businessId]);
    expect(row.rows[0].checklist_dismissed).toBe(false);
  });

  it("A cannot write B's settings directly: no update of other columns, no insert, no delete", async () => {
    await expect(asA(() => db.query(`update public.business_settings set phone = 'x' where business_id = $1`, [b.businessId]))).rejects.toThrow(/permission denied/);
    await expect(asA(() => db.query(`delete from public.business_settings where business_id = $1`, [b.businessId]))).rejects.toThrow(/permission denied/);
    await expect(asA(() => db.query(`insert into public.business_settings (business_id) values ($1)`, [b.businessId]))).rejects.toThrow(/permission denied/);
    await expect(asA(() => db.query(`update public.businesses set name = 'hacked' where id = $1`, [b.businessId]))).rejects.toThrow(/permission denied/);
  });
});

describe("import isolation", () => {
  it("A cannot see B's imports", async () => {
    const res = await asA(() => db.query(`select id from public.imports where id = $1`, [importB]));
    expect(res.rows).toHaveLength(0);
  });

  it("A cannot insert an import for B, and cannot update or delete any import", async () => {
    await expect(asA(() => db.query(
      `insert into public.imports (id, business_id, file_name, file_kind, submitted_rows, created_count, created_similar_count, skipped_count, status_counts, skipped, fingerprint)
       values ($1,$2,'x.csv','csv',0,0,0,0,'{}'::jsonb,'[]'::jsonb,'fp')`, [randomUUID(), b.businessId]))).rejects.toThrow(/row-level security/i);
    await expect(asA(() => db.query(`update public.imports set file_name = 'x' where id = $1`, [importB]))).rejects.toThrow(/permission denied/);
    await expect(asA(() => db.query(`delete from public.imports where id = $1`, [importB]))).rejects.toThrow(/permission denied/);
  });

  it("import_apply with B's import id does not replay B's import and changes nothing of B's", async () => {
    const before = await db.query(`select count(*)::int as n from public.products where business_id = $1`, [b.businessId]);
    const rows = '[{"row_no":2,"name":"Z","unit":"strip"}]';
    const preview = await asA(() => db.query<{ p: { fingerprint: string } }>(`select public.import_preview($1::jsonb) as p`, [rows]));
    // The id belongs to B, so it is not found for A (no replay of B's result); the insert then hits the
    // primary key and the whole transaction is rolled back. B's data is never returned or changed.
    await expect(
      asA(() => db.query(`select public.import_apply($1,'x.csv','csv',$2::jsonb,'[]'::jsonb,$3,'{}'::int[])`, [importB, rows, preview.rows[0].p.fingerprint])),
    ).rejects.toThrow(/duplicate key|unique/i);
    const zed = await db.query(`select 1 from public.products where name = 'Z'`);
    expect(zed.rows).toHaveLength(0);
    const after = await db.query(`select count(*)::int as n from public.products where business_id = $1`, [b.businessId]);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("a product of A cannot reference B's import, by insert or by update", async () => {
    await expect(
      asA(() => db.query(`insert into public.products (id, name, unit, import_id) values ($1,'Cross','strip',$2)`, [randomUUID(), importB])),
    ).rejects.toThrow(/foreign key|violates/i);
    const own = randomUUID();
    await asA(() => db.query(`insert into public.products (id, name, unit) values ($1,'Own','strip')`, [own]));
    await expect(asA(() => db.query(`update public.products set import_id = $1 where id = $2`, [importB, own]))).rejects.toThrow(/foreign key|violates/i);
  });

  it("preview and classification never see B's catalog", async () => {
    const res = await asA(() => db.query<{ status: string }>(`select status from public.import_classify('[{"row_no":2,"name":"B med","unit":"strip"}]'::jsonb)`));
    expect(res.rows[0].status).toBe("new");
  });

  it("anon cannot call the import or settings functions", async () => {
    await expect(withRole(db, "anon", null, () => db.query(`select public.import_preview('[]'::jsonb)`))).rejects.toThrow(/permission denied/);
    await expect(withRole(db, "anon", null, () => db.query(save(1, "X")))).rejects.toThrow(/permission denied/);
  });
});
