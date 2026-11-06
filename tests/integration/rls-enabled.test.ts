import { describe, expect, it } from "vitest";
import { hasTestEnv, serviceClient, SKIP_REASON } from "../helpers/supabase-test";

// Guard for future modules: every table in the public schema must have RLS enabled, and every table
// other than businesses/profiles must carry business_id. Runs against the Supabase test project.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

suite("every public table is protected", () => {
  it("has RLS enabled and a business_id column where required", async () => {
    const { data, error } = await serviceClient().rpc("rls_audit");
    expect(error).toBeNull();
    const rows = (data ?? []) as { table_name: string; rls_enabled: boolean; has_business_id: boolean }[];
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) {
      expect(row.rls_enabled, `${row.table_name} must have RLS enabled`).toBe(true);
      if (row.table_name !== "businesses" && row.table_name !== "profiles") {
        expect(row.has_business_id, `${row.table_name} must have business_id`).toBe(true);
      }
    }
  });
});
