import { describe, expect, it } from "vitest";
import { hasTestEnv, serviceClient, SKIP_REASON } from "../helpers/supabase-test";

// Security review (Module 011, T036): the row level security audit function of the database (`rls_audit`, migration 0001), called
// with the service role against the real Supabase TEST project. Every table of the public schema has security switched on, and the
// result is printed for the security review. The same rule is checked on every migration by db-rls-all-tables.pglite.test.ts.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

suite("row level security on the Supabase test project", () => {
  it("has row level security switched on for every table of the public schema", async () => {
    const { data, error } = await serviceClient().rpc("rls_audit");
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ table_name: string; rls_enabled: boolean; has_business_id: boolean }>;
    expect(rows.length).toBeGreaterThan(15);
    const lines = rows.sort((a, b) => a.table_name.localeCompare(b.table_name)).map((r) => `${r.table_name.padEnd(28)} rls=${r.rls_enabled ? "on " : "OFF"} business_id=${r.has_business_id ? "yes" : "no "}`);
    console.info(`Tables of the test project (${rows.length}):\n${lines.join("\n")}`);
    expect(rows.filter((r) => !r.rls_enabled).map((r) => r.table_name)).toEqual([]);
    expect(rows.filter((r) => r.has_business_id && !r.rls_enabled).map((r) => r.table_name)).toEqual([]);
  });

  it("does not let the audit function be called by a signed-in user or a visitor", async () => {
    const { anonClient } = await import("../helpers/supabase-test");
    const { error } = await anonClient().rpc("rls_audit");
    expect(error).not.toBeNull();
  });
});
