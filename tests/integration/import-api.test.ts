import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { readJsonBodyCapped } from "@/lib/api/body";
import { applyImport, getImport, listImports, previewImport } from "@/lib/imports/repository";
import { createProduct } from "@/lib/products/repository";
import type { RawRow } from "@/lib/import/types";
import { ApplyRequestSchema, PreviewRequestSchema } from "@/lib/validation/import";
import { ProductCreateSchema } from "@/lib/validation/product";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// The code behind /api/imports/* against a real Supabase test project, signed in as a real user so
// Row Level Security is in effect. Skipped without test credentials.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const row = (row_no: number, name: string, extra: Partial<RawRow> = {}): RawRow => ({ row_no, name, unit: "strip", ...extra });
const request = (rows: RawRow[], fingerprint: string, extra: Record<string, unknown> = {}) =>
  ApplyRequestSchema.parse({ import_id: randomUUID(), file_name: "list.csv", file_kind: "csv", rows, fingerprint, ...extra });
const errorOf = async (promise: Promise<unknown>) => (await promise.then(() => null, (e) => e)) as ApiError | null;

suite("import API against Supabase", () => {
  let a: TestTenant;
  let b: TestTenant;

  const count = async (t: TestTenant) => {
    const { count } = await t.client.from("products").select("id", { count: "exact", head: true });
    return count ?? 0;
  };

  beforeAll(async () => {
    a = await createTenant("import-a");
    b = await createTenant("import-b");
  });
  afterAll(async () => {
    await deleteTenant(a);
    await deleteTenant(b);
  });

  it("previews with counts and a fingerprint, and reports invalid rows the client sent as fine", async () => {
    await createProduct(a.client, ProductCreateSchema.parse({ id: randomUUID(), name: "Panadol", unit: "strip", strength: "500 mg" }));
    const rows = [
      row(2, "Amoxil"),
      row(3, "Panadol", { strength: "500 mg" }),
      row(4, "Panadol", { strength: "250 mg" }),
      row(5, "Brufen", { selling_price: "abc" }),
      { row_no: 6, name: "", unit: "strip" },
    ];
    const preview = await previewImport(a.client, rows);
    expect(preview.total).toBe(5);
    expect(preview.counts).toEqual({ new: 1, exists: 1, similar: 1, file_duplicate: 0, sku_used: 0, invalid: 2 });
    expect(preview.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(preview.rows.map((r) => [r.row_no, r.status])).toEqual([[2, "new"], [3, "exists"], [4, "similar"], [5, "invalid"], [6, "invalid"]]);
    expect(preview.rows[1].conflict?.name).toBe("Panadol");
    expect(preview.rows[3]).toMatchObject({ field: "selling_price", message: expect.stringMatching(/digits/) });
    expect(preview.rows[4]).toMatchObject({ field: "name" });
    // preview saved nothing
    expect(await count(a)).toBe(1);
    // the same rows give the same fingerprint while the catalog is unchanged
    expect((await previewImport(a.client, rows)).fingerprint).toBe(preview.fingerprint);
  });

  it("applies, replays on the same import id, and lists the history", async () => {
    const rows = [row(2, "Apply A"), row(3, "Apply B", { selling_price: "10.5" })];
    const { fingerprint } = await previewImport(a.client, rows);
    const req = request(rows, fingerprint);
    const before = await count(a);
    const first = await applyImport(a.client, req);
    expect(first).toMatchObject({ applied: true, replayed: false, import: { created_count: 2, skipped_count: 0 } });
    expect(await count(a)).toBe(before + 2);

    const again = await applyImport(a.client, req);
    expect(again).toMatchObject({ applied: true, replayed: true, import: { id: req.import_id, created_count: 2 } });
    expect(await count(a)).toBe(before + 2);

    const list = await listImports(a.client, 20);
    expect(list.items.some((i) => i.id === req.import_id)).toBe(true);
    expect(list.items[0].skipped).toBeUndefined();
    const detail = await getImport(a.client, req.import_id);
    expect(detail?.skipped).toEqual([]);
  });

  it("10 simultaneous confirms with the same import id create the rows once", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(i + 2, `Parallel ${i}`));
    const { fingerprint } = await previewImport(a.client, rows);
    const req = request(rows, fingerprint);
    const before = await count(a);
    const results = await Promise.all(Array.from({ length: 10 }, () => applyImport(a.client, req)));
    expect(results.every((r) => r.applied)).toBe(true);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await count(a)).toBe(before + 20);
  });

  it("two simultaneous imports with different ids and the same rows: one applies, the other is refused", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(i + 2, `Race ${i}`));
    const { fingerprint } = await previewImport(a.client, rows);
    const before = await count(a);
    const settled = await Promise.allSettled([
      applyImport(a.client, request(rows, fingerprint)),
      applyImport(a.client, request(rows, fingerprint)),
    ]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.filter((s) => s.status === "rejected") as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as ApiError).code).toBe("import_changed");
    expect(await count(a)).toBe(before + 10);
  });

  it("refuses with import_changed, creating nothing, when the catalog changed after the preview", async () => {
    const rows = [row(2, "Changed One"), row(3, "Changed Two")];
    const { fingerprint } = await previewImport(a.client, rows);
    await createProduct(a.client, ProductCreateSchema.parse({ id: randomUUID(), name: "Changed Two", unit: "strip" }));
    const before = await count(a);
    const error = await errorOf(applyImport(a.client, request(rows, fingerprint)));
    expect(error?.code).toBe("import_changed");
    expect(error?.status).toBe(409);
    expect(await count(a)).toBe(before);
  });

  it("creates a chosen similar row as a separate product and refuses one that is not similar", async () => {
    await createProduct(a.client, ProductCreateSchema.parse({ id: randomUUID(), name: "Sim Med", unit: "strip", strength: "1 mg" }));
    const rows = [row(2, "Sim Med", { strength: "2 mg" })];
    const { fingerprint } = await previewImport(a.client, rows);
    const ok = await applyImport(a.client, request(rows, fingerprint, { create_similar: [2] }));
    expect(ok.import).toMatchObject({ created_count: 1, created_similar_count: 1 });

    const fresh = [row(2, "Not Similar At All")];
    const fp = (await previewImport(a.client, fresh)).fingerprint;
    expect((await errorOf(applyImport(a.client, request(fresh, fp, { create_similar: [2] }))))?.code).toBe("import_changed");
  });

  it("refuses to import when no row is valid", async () => {
    const rows: RawRow[] = [{ row_no: 2, name: "", unit: "strip" }];
    const { fingerprint } = await previewImport(a.client, rows);
    expect((await errorOf(applyImport(a.client, request(rows, fingerprint))))?.code).toBe("validation_error");
  });

  it("limits: more than 10,000 rows and duplicate row numbers are refused by the request schemas", () => {
    const many = Array.from({ length: 10001 }, (_, i) => ({ row_no: i + 2, name: "x", unit: "y" }));
    expect(() => PreviewRequestSchema.parse({ rows: many })).toThrow();
    expect(() => PreviewRequestSchema.parse({ rows: [{ row_no: 2, name: "x", unit: "y" }, { row_no: 2, name: "z", unit: "y" }] })).toThrow();
    expect(() => PreviewRequestSchema.parse({ rows: [] })).toThrow();
    expect(() => PreviewRequestSchema.parse({ rows: [{ row_no: 2, name: "x", unit: "y", business_id: "nope" }] })).toThrow();
  });

  it("a body over 4 MB is refused before parsing", async () => {
    const big = JSON.stringify({ rows: [{ row_no: 2, name: "x".repeat(4 * 1024 * 1024 + 10) }] });
    const error = await errorOf(readJsonBodyCapped(new Request("http://localhost/api/imports", { method: "POST", body: big })));
    expect(error?.code).toBe("validation_error");
    expect(error?.message).toMatch(/Split it into two files/);
  });

  it("another business cannot read this import and does not see its medicines", async () => {
    const rows = [row(2, "Private Import")];
    const { fingerprint } = await previewImport(a.client, rows);
    const req = request(rows, fingerprint);
    await applyImport(a.client, req);
    expect(await getImport(b.client, req.import_id)).toBeNull();
    expect((await listImports(b.client, 100)).items.some((i) => i.id === req.import_id)).toBe(false);
    expect((await previewImport(b.client, rows)).counts.new).toBe(1); // new in B's own (empty) catalog
  });
});
