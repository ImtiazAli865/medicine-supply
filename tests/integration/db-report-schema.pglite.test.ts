import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationFile, createTestDb } from "../helpers/pglite";

// Migration 0011 adds read-only functions and one index and nothing else (plan D1): no table, no column, every
// function SECURITY INVOKER and STABLE, executable by signed-in users only, and the file can be applied twice.

// Updated story by story: the full list is the seven report functions plus the period helper.
// (the end state is ten names: report_check_period, report_sales_lines, report_money, report_figure, report_sales,
// report_cost_missing, report_purchases, report_by_store, report_by_medicine, report_not_in_account).
const EXPECTED = [
  "report_check_period", "report_sales_lines", "report_money", "report_figure", "report_bucket_start", "report_bucket_end",
  "report_sales", "report_cost_missing", "report_purchases", "report_by_store", "report_by_medicine", "report_not_in_account",
];
const PURE_HELPERS = ["report_money", "report_figure", "report_bucket_start", "report_bucket_end"];

let db: PGlite;
let tablesBefore: string[];
let columnsBefore: string[];

async function tables(d: PGlite): Promise<string[]> {
  const res = await d.query<{ t: string }>(`select table_name as t from information_schema.tables where table_schema = 'public' order by 1`);
  return res.rows.map((r) => r.t);
}

async function columns(d: PGlite): Promise<string[]> {
  const res = await d.query<{ c: string }>(
    `select table_name || '.' || column_name as c from information_schema.columns where table_schema = 'public' order by 1`,
  );
  return res.rows.map((r) => r.c);
}

beforeAll(async () => {
  // The schema as it was before this module, then this module on top.
  const before = await createTestDb({ upTo: "0008_store_accounts.sql" });
  tablesBefore = await tables(before);
  columnsBefore = await columns(before);
  await before.close();
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("migration 0011 shape", () => {
  it("can be applied a second time without an error", async () => {
    await expect(applyMigrationFile(db, "0011_reports.sql")).resolves.not.toThrow();
  });

  it("adds no table and no column", async () => {
    expect(await tables(db)).toEqual(tablesBefore);
    expect(await columns(db)).toEqual(columnsBefore);
  });

  it("creates the index on invoices and nothing stored", async () => {
    const res = await db.query<{ indexname: string }>(`select indexname from pg_indexes where schemaname = 'public' and indexname = 'invoices_report_idx'`);
    expect(res.rows).toHaveLength(1);
  });

  it("has exactly the expected report functions", async () => {
    const res = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'report\\_%' order by 1`,
    );
    expect(res.rows.map((r) => r.proname)).toEqual([...EXPECTED].sort());
  });

  it("makes every report function SECURITY INVOKER and STABLE (the two pure helpers IMMUTABLE)", async () => {
    const res = await db.query<{ proname: string; prosecdef: boolean; provolatile: string }>(
      `select p.proname, p.prosecdef, p.provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'report\\_%'`,
    );
    expect(res.rows.length).toBe(EXPECTED.length);
    for (const row of res.rows) {
      expect(row.prosecdef, `${row.proname} must be SECURITY INVOKER`).toBe(false);
      const pure = PURE_HELPERS.includes(row.proname);
      expect(row.provolatile, `${row.proname} must be ${pure ? "IMMUTABLE" : "STABLE"}`).toBe(pure ? "i" : "s");
    }
  });

  it("lets signed-in users execute them and nobody else (not anon, not public)", async () => {
    const res = await db.query<{ proname: string; anon: boolean; authed: boolean }>(
      `select p.proname,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authed
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'report\\_%'`,
    );
    for (const row of res.rows) {
      expect(row.anon, `${row.proname} must not be executable by anon`).toBe(false);
      expect(row.authed, `${row.proname} must be executable by authenticated`).toBe(true);
    }
  });

  it("sets a fixed search path on every report function", async () => {
    const res = await db.query<{ proname: string; proconfig: string[] | null }>(
      `select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'report\\_%'`,
    );
    for (const row of res.rows) expect((row.proconfig ?? []).join(","), row.proname).toContain("search_path=public");
  });
});
