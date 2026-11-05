import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyImport, getImport, previewImport } from "@/lib/imports/repository";
import { ApplyRequestSchema } from "@/lib/validation/import";
import { anonClient, createTenant, deleteTenant, hasTestEnv, SKIP_REASON, serviceClient, type TestTenant } from "../helpers/supabase-test";

// Isolation of settings, import records and imported medicines between two real businesses, on the
// Supabase test project. Every request is made as a real signed-in user, so RLS is in effect.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

suite("Module 002 isolation against Supabase", () => {
  let a: TestTenant;
  let b: TestTenant;
  let importB: string;
  const shared = { row_no: 2, name: "Shared Name", unit: "strip", strength: "10 mg" };

  beforeAll(async () => {
    a = await createTenant("rls2-a");
    b = await createTenant("rls2-b");
    importB = randomUUID();
    const rows = [shared];
    const { fingerprint } = await previewImport(b.client, rows);
    await applyImport(b.client, ApplyRequestSchema.parse({ import_id: importB, file_name: "b.csv", file_kind: "csv", rows, fingerprint }));
  });
  afterAll(async () => {
    await deleteTenant(a);
    await deleteTenant(b);
  });

  const productCount = async (businessId: string) => {
    const { count } = await serviceClient().from("products").select("id", { count: "exact", head: true }).eq("business_id", businessId);
    return count ?? 0;
  };

  it("A sees only its own settings row and no import of B", async () => {
    const settings = await a.client.from("business_settings").select("business_id");
    expect(settings.data?.map((r) => r.business_id)).toEqual([a.businessId]);
    const imports = await a.client.from("imports").select("id");
    expect(imports.data).toEqual([]);
    expect(await getImport(a.client, importB)).toBeNull();
  });

  it("A cannot write B's settings or its own protected columns, and cannot insert or delete", async () => {
    expect((await a.client.from("business_settings").update({ phone: "1" }).eq("business_id", b.businessId!)).error?.code).toBe("42501");
    expect((await a.client.from("business_settings").update({ thermal_paper_mm: 58 }).eq("business_id", a.businessId!)).error?.code).toBe("42501");
    expect((await a.client.from("business_settings").update({ version: 99 }).eq("business_id", a.businessId!)).error?.code).toBe("42501");
    expect((await a.client.from("business_settings").insert({ business_id: b.businessId })).error?.code).toBe("42501");
    expect((await a.client.from("business_settings").delete().eq("business_id", b.businessId!)).error?.code).toBe("42501");
    expect((await a.client.from("businesses").update({ name: "hacked" }).eq("id", b.businessId!)).error?.code).toBe("42501");
    const bRow = await serviceClient().from("business_settings").select("phone,version,thermal_paper_mm").eq("business_id", b.businessId!).single();
    expect(bRow.data).toEqual({ phone: null, version: 1, thermal_paper_mm: 80 });
  });

  it("A cannot create, change or delete import records, and cannot link a product to B's import", async () => {
    const row = { id: randomUUID(), business_id: b.businessId, file_name: "x.csv", file_kind: "csv", submitted_rows: 0, created_count: 0, created_similar_count: 0, skipped_count: 0, status_counts: {}, skipped: [], fingerprint: "x" };
    expect((await a.client.from("imports").insert(row)).error).not.toBeNull();
    expect((await a.client.from("imports").update({ file_name: "x" }).eq("id", importB)).error?.code).toBe("42501");
    expect((await a.client.from("imports").delete().eq("id", importB)).error?.code).toBe("42501");
    const link = await a.client.from("products").insert({ id: randomUUID(), name: "Cross", unit: "strip", import_id: importB });
    expect(link.error).not.toBeNull();
  });

  it("an import by A uses only A's catalog and changes 0 records of B's", async () => {
    const beforeB = await productCount(b.businessId!);
    const rows = [shared];
    const preview = await previewImport(a.client, rows);
    expect(preview.counts.new).toBe(1); // B's identical medicine is invisible to A
    const res = await applyImport(a.client, ApplyRequestSchema.parse({ import_id: randomUUID(), file_name: "a.csv", file_kind: "csv", rows, fingerprint: preview.fingerprint }));
    expect(res.import.created_count).toBe(1);
    expect(await productCount(b.businessId!)).toBe(beforeB);
    const bProducts = await serviceClient().from("products").select("business_id,import_id").eq("business_id", b.businessId!);
    expect(bProducts.data?.every((p) => p.import_id === importB)).toBe(true);
  });

  it("A's import function call with B's import id never returns or changes B's import", async () => {
    const rows = [{ row_no: 2, name: "Probe", unit: "strip" }];
    const { fingerprint } = await previewImport(a.client, rows);
    const { data, error } = await a.client.rpc("import_apply", {
      p_import_id: importB, p_file_name: "p.csv", p_file_kind: "csv", p_rows: rows, p_invalid: [], p_fingerprint: fingerprint, p_create_similar: [],
    });
    expect(error).not.toBeNull(); // primary-key clash; the transaction rolled back
    expect(data).toBeNull();
    expect(await getImport(b.client, importB)).toMatchObject({ id: importB, created_count: 1 });
  });

  it("a signed-out visitor cannot read settings or imports or call the functions", async () => {
    const anon = anonClient();
    expect((await anon.from("business_settings").select("*")).error?.code).toBe("42501");
    expect((await anon.from("imports").select("*")).error?.code).toBe("42501");
    expect((await anon.rpc("import_preview", { p_rows: [] })).error?.code).toBe("42501");
    expect((await anon.rpc("import_apply", { p_import_id: randomUUID(), p_file_name: "x", p_file_kind: "csv", p_rows: [], p_invalid: [], p_fingerprint: "x", p_create_similar: [] })).error?.code).toBe("42501");
  });
});
