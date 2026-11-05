import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";

// import_classify / import_preview / import_apply on a real PostgreSQL engine (PGlite),
// with two businesses and the `authenticated` role so Row Level Security is in force.

let db: PGlite;
let a: Tenant;
let b: Tenant;

const asA = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", a.userId, fn);
const asB = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", b.userId, fn);

interface R {
  row_no: number;
  name: string;
  unit?: string;
  brand?: string | null;
  generic_name?: string | null;
  strength?: string | null;
  dosage_form?: string | null;
  manufacturer?: string | null;
  pack_size?: string | null;
  sku?: string | null;
  purchase_price?: string | null;
  selling_price?: string | null;
  mrp?: string | null;
}
const row = (row_no: number, name: string, extra: Partial<R> = {}): R => ({ row_no, name, unit: "strip", ...extra });

async function seed(t: Tenant, name: string, extra: Record<string, string | boolean | null> = {}) {
  const id = randomUUID();
  await db.query(
    `insert into public.products (id, business_id, name, unit, strength, dosage_form, pack_size, manufacturer, sku, is_active)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, t.businessId, name, extra.unit ?? "strip", extra.strength ?? null, extra.dosage_form ?? null, extra.pack_size ?? null,
      extra.manufacturer ?? null, extra.sku ?? null, extra.is_active ?? true],
  );
  return id;
}

async function classify(rows: R[]) {
  const res = await asA(() => db.query<{ row_no: number; status: string; conflict_product_id: string | null; conflict_name: string | null }>(
    `select * from public.import_classify($1::jsonb)`, [JSON.stringify(rows)]));
  return res.rows;
}
const statuses = async (rows: R[]) => Object.fromEntries((await classify(rows)).map((r) => [r.row_no, r.status]));

async function preview(rows: R[]) {
  const res = await asA(() => db.query<{ p: { fingerprint: string; rows: { row_no: number; status: string }[] } }>(
    `select public.import_preview($1::jsonb) as p`, [JSON.stringify(rows)]));
  return res.rows[0].p;
}

interface ApplyResult {
  applied: boolean;
  replayed?: boolean;
  reason?: string;
  import?: { id: string; created_count: number; created_similar_count: number; skipped_count: number; submitted_rows: number;
    status_counts: Record<string, number>; skipped: { row_no: number; status: string; message: string }[] };
}
async function apply(opts: { id?: string; rows: R[]; invalid?: unknown[]; fingerprint?: string; create?: number[]; as?: "A" | "B" }) {
  const id = opts.id ?? randomUUID();
  const fingerprint = opts.fingerprint ?? (await preview(opts.rows)).fingerprint;
  const run = opts.as === "B" ? asB : asA;
  const res = await run(() => db.query<{ r: ApplyResult }>(
    `select public.import_apply($1, 'file.csv', 'csv', $2::jsonb, $3::jsonb, $4, $5::int[]) as r`,
    [id, JSON.stringify(opts.rows), JSON.stringify(opts.invalid ?? []), fingerprint, `{${(opts.create ?? []).join(",")}}`]));
  return { id, result: res.rows[0].r };
}

const count = async (t: Tenant) =>
  Number((await db.query<{ n: string }>(`select count(*)::text as n from public.products where business_id = $1`, [t.businessId])).rows[0].n);
const importCount = async (t: Tenant) =>
  Number((await db.query<{ n: string }>(`select count(*)::text as n from public.imports where business_id = $1`, [t.businessId])).rows[0].n);

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
  b = await createTenant(db, "b");
});
afterAll(async () => {
  await db.close();
});

describe("import_classify", () => {
  it("returns new for an empty catalog", async () => {
    expect(await statuses([row(2, "Amoxil"), row(3, "Brufen")])).toEqual({ 2: "new", 3: "new" });
  });

  it("marks an exact duplicate as exists and names the existing medicine", async () => {
    const id = await seed(a, "Panadol", { strength: "500 mg", dosage_form: "Tablet", pack_size: "10 tabs", manufacturer: "GSK" });
    const out = await classify([row(2, "  PANADOL ", { strength: "500  MG", dosage_form: "tablet", pack_size: "10 TABS", manufacturer: "gsk" })]);
    expect(out[0]).toMatchObject({ status: "exists", conflict_product_id: id, conflict_name: "Panadol" });
  });

  it("ignores the unit when deciding identity", async () => {
    await seed(a, "Zantac", { unit: "box" });
    expect(await statuses([row(2, "Zantac", { unit: "strip" })])).toEqual({ 2: "exists" });
  });

  it("counts an inactive medicine as existing", async () => {
    await seed(a, "Inactive One", { is_active: false });
    expect(await statuses([row(2, "Inactive One")])).toEqual({ 2: "exists" });
  });

  it("marks same name with different strength, form, pack size or manufacturer as similar", async () => {
    await seed(a, "Calpol", { strength: "120 mg", dosage_form: "Syrup", pack_size: "60 ml", manufacturer: "GSK" });
    const s = await statuses([
      row(2, "Calpol", { strength: "250 mg", dosage_form: "Syrup", pack_size: "60 ml", manufacturer: "GSK" }),
      row(3, "Calpol", { strength: "120 mg", dosage_form: "Suspension", pack_size: "60 ml", manufacturer: "GSK" }),
      row(4, "Calpol", { strength: "120 mg", dosage_form: "Syrup", pack_size: "90 ml", manufacturer: "GSK" }),
      row(5, "Calpol", { strength: "120 mg", dosage_form: "Syrup", pack_size: "60 ml", manufacturer: "Other" }),
    ]);
    expect(s).toEqual({ 2: "similar", 3: "similar", 4: "similar", 5: "similar" });
  });

  it("marks later identical rows as file_duplicate; the first stays new", async () => {
    const s = await statuses([row(2, "Dup Med", { strength: "5 mg" }), row(3, "dup  med", { strength: "5 MG" }), row(4, "Dup Med", { strength: "5 mg" })]);
    expect(s).toEqual({ 2: "new", 3: "file_duplicate", 4: "file_duplicate" });
  });

  it("rows with the same name but different details inside one file are each new", async () => {
    const s = await statuses([row(2, "Same Name", { strength: "5 mg" }), row(3, "Same Name", { strength: "10 mg" })]);
    expect(s).toEqual({ 2: "new", 3: "new" });
  });

  it("marks a SKU already used by an existing medicine as sku_used (case and spacing ignored)", async () => {
    const id = await seed(a, "Has Sku", { sku: "SKU-1" });
    const out = await classify([row(2, "Other Name", { sku: " sku-1 " })]);
    expect(out[0]).toMatchObject({ status: "sku_used", conflict_product_id: id, conflict_name: "Has Sku" });
  });

  it("marks a repeated SKU inside the file as sku_used, even when the earlier row is itself skipped", async () => {
    await seed(a, "Existing Skipped", { strength: "1 mg" });
    const s = await statuses([
      row(2, "Existing Skipped", { strength: "1 mg", sku: "NEW-SKU" }), // exists -> skipped
      row(3, "Another", { sku: "new-sku" }), // earlier row used the SKU, although it is skipped
    ]);
    expect(s).toEqual({ 2: "exists", 3: "sku_used" });
  });

  it("applies the status priority: file_duplicate > exists > sku_used > similar > new", async () => {
    await seed(a, "Prio", { strength: "1 mg", sku: "PRIO-SKU" });
    await seed(a, "Prio Sim", { strength: "1 mg" });
    const s = await statuses([
      row(2, "Prio", { strength: "1 mg", sku: "OTHER" }), // exists (identity) even with a different sku
      row(3, "Prio", { strength: "1 mg", sku: "OTHER" }), // file_duplicate beats exists
      row(4, "Prio Sim", { strength: "2 mg", sku: "PRIO-SKU" }), // sku_used beats similar
      row(5, "Prio Sim", { strength: "3 mg" }), // similar
    ]);
    expect(s).toEqual({ 2: "exists", 3: "file_duplicate", 4: "sku_used", 5: "similar" });
  });

  it("never reads another business's catalog", async () => {
    await seed(b, "Only In B", { sku: "B-SKU" });
    expect(await statuses([row(2, "Only In B", { sku: "B-SKU" })])).toEqual({ 2: "new" });
  });
});

describe("import_preview", () => {
  it("gives the same fingerprint twice, and a different one when the catalog changes", async () => {
    const rows = [row(2, "Fp One"), row(3, "Fp Two")];
    const p1 = await preview(rows);
    const p2 = await preview(rows);
    expect(p1.fingerprint).toBe(p2.fingerprint);
    await seed(a, "Fp Two");
    const p3 = await preview(rows);
    expect(p3.fingerprint).not.toBe(p1.fingerprint);
    expect(p3.rows.find((r) => r.row_no === 3)?.status).toBe("exists");
  });
});

describe("import_apply", () => {
  it("creates exactly the new rows, with exact values and empty cells as NULL, linked to the import", async () => {
    const rows = [
      row(2, "Apply One", { brand: "Brand", generic_name: "Gen", strength: "10 mg", dosage_form: "Tablet", manufacturer: "Acme",
        pack_size: "10 tabs", sku: "AP-1", purchase_price: "40.50", selling_price: "55", mrp: "60.10" }),
      row(3, "Apply Two", { brand: "", strength: "", purchase_price: "", selling_price: "", mrp: "" }),
    ];
    const before = await count(a);
    const { id, result } = await apply({ rows });
    expect(result.applied).toBe(true);
    expect(result.replayed).toBe(false);
    expect(result.import).toMatchObject({ created_count: 2, created_similar_count: 0, skipped_count: 0, submitted_rows: 2 });
    expect(await count(a)).toBe(before + 2);
    const one = (await db.query<Record<string, unknown>>(`select * from public.products where name = 'Apply One' and business_id = $1`, [a.businessId])).rows[0];
    expect(one).toMatchObject({ brand: "Brand", generic_name: "Gen", strength: "10 mg", sku: "AP-1", import_id: id, is_active: true });
    // numeric(12,2): exactly the file's values, stored with two decimals
    expect(String(one.purchase_price)).toBe("40.50");
    expect(String(one.selling_price)).toBe("55.00");
    expect(String(one.mrp)).toBe("60.10");
    const two = (await db.query<Record<string, unknown>>(`select * from public.products where name = 'Apply Two' and business_id = $1`, [a.businessId])).rows[0];
    for (const k of ["brand", "generic_name", "strength", "dosage_form", "manufacturer", "pack_size", "sku", "purchase_price", "selling_price", "mrp"]) {
      expect(two[k], k).toBeNull();
    }
    expect(two.import_id).toBe(id);
  });

  it("applies exactly the preview: counts per status equal the preview and nothing else is created", async () => {
    await seed(a, "Mix Exists", { strength: "1 mg" });
    await seed(a, "Mix Similar", { strength: "1 mg" });
    await seed(a, "Mix SkuOwner", { sku: "MIX-SKU" });
    const rows = [
      row(2, "Mix New"),
      row(3, "Mix Exists", { strength: "1 mg" }),
      row(4, "Mix Similar", { strength: "2 mg" }),
      row(5, "Mix New"),
      row(6, "Mix Sku", { sku: "mix-sku" }),
    ];
    const pv = await preview(rows);
    const previewCounts: Record<string, number> = {};
    for (const r of pv.rows) previewCounts[r.status] = (previewCounts[r.status] ?? 0) + 1;
    const before = await count(a);
    const { result } = await apply({ rows, fingerprint: pv.fingerprint });
    expect(result.import!.status_counts).toEqual(previewCounts);
    expect(result.import!.created_count).toBe(previewCounts.new);
    expect(await count(a)).toBe(before + previewCounts.new);
    expect(result.import!.skipped.map((s) => [s.row_no, s.status])).toEqual([[3, "exists"], [4, "similar"], [5, "file_duplicate"], [6, "sku_used"]]);
    // never created: exists, similar (not chosen), file_duplicate, sku_used
    const names = (await db.query<{ name: string }>(`select name from public.products where business_id = $1 and import_id = $2`, [a.businessId, result.import!.id])).rows;
    expect(names.map((n) => n.name)).toEqual(["Mix New"]);
  });

  it("creates a chosen similar row as a separate product and counts it", async () => {
    await seed(a, "Choose Sim", { strength: "1 mg" });
    const rows = [row(2, "Choose Sim", { strength: "2 mg" }), row(3, "Choose Sim", { strength: "3 mg" })];
    const { result } = await apply({ rows, create: [2] });
    expect(result.import).toMatchObject({ created_count: 1, created_similar_count: 1, skipped_count: 1 });
    const strengths = (await db.query<{ strength: string }>(`select strength from public.products where business_id = $1 and name = 'Choose Sim' order by strength`, [a.businessId])).rows.map((r) => r.strength);
    expect(strengths).toEqual(["1 mg", "2 mg"]);
  });

  it("records invalid rows from the caller in counts and in the skipped list", async () => {
    const { result } = await apply({
      rows: [row(3, "Inv Ok")],
      invalid: [{ row_no: 2, field: "unit", message: "Unit is required" }],
    });
    expect(result.import!.submitted_rows).toBe(2);
    expect(result.import!.status_counts).toEqual({ new: 1, invalid: 1 });
    expect(result.import!.skipped).toEqual([expect.objectContaining({ row_no: 2, status: "invalid", message: "unit: Unit is required" })]);
  });

  it("applies nothing and returns catalog_changed when the catalog changed after the preview", async () => {
    const rows = [row(2, "Late One"), row(3, "Late Two")];
    const pv = await preview(rows);
    await seed(a, "Late Two"); // added elsewhere between preview and confirm
    const before = await count(a);
    const imports = await importCount(a);
    const { result } = await apply({ rows, fingerprint: pv.fingerprint });
    expect(result).toEqual({ applied: false, reason: "catalog_changed" });
    expect(await count(a)).toBe(before);
    expect(await importCount(a)).toBe(imports);
  });

  it("applies nothing when a chosen similar row is not similar", async () => {
    const rows = [row(2, "Not Similar")];
    const before = await count(a);
    const { result } = await apply({ rows, create: [2] });
    expect(result).toEqual({ applied: false, reason: "catalog_changed" });
    expect(await count(a)).toBe(before);
  });

  it("replays the same import id: returns the original result and creates nothing", async () => {
    const rows = [row(2, "Replay One"), row(3, "Replay Two")];
    const first = await apply({ rows });
    const before = await count(a);
    const again = await apply({ id: first.id, rows, fingerprint: "stale-fingerprint-is-ignored-on-replay" });
    expect(again.result.applied).toBe(true);
    expect(again.result.replayed).toBe(true);
    expect(again.result.import).toMatchObject({ id: first.id, created_count: 2 });
    expect(await count(a)).toBe(before);
    for (let i = 0; i < 5; i++) await apply({ id: first.id, rows });
    expect(await count(a)).toBe(before);
  });

  it("is all-or-nothing: a failure inside the import leaves no products and no import record", async () => {
    const tooLong = "X".repeat(201); // passes classification, violates the products name check
    const rows = [row(2, "Atomic Good"), row(3, tooLong)];
    const fingerprint = (await preview(rows)).fingerprint;
    const before = await count(a);
    const imports = await importCount(a);
    const id = randomUUID();
    await expect(apply({ id, rows, fingerprint })).rejects.toThrow(/check|violates/i);
    expect(await count(a)).toBe(before);
    expect(await importCount(a)).toBe(imports);
    expect((await db.query(`select 1 from public.imports where id = $1`, [id])).rows).toHaveLength(0);
    // the same file without the bad row still imports afterwards (a retry is safe)
    const ok = await apply({ rows: [row(2, "Atomic Good")] });
    expect(ok.result.applied).toBe(true);
  });

  it("an import by one business never reads or changes the other's catalog", async () => {
    await seed(b, "Cross Med", { strength: "1 mg" });
    const bBefore = await count(b);
    const bRows = (await db.query(`select id, version from public.products where business_id = $1 order by id`, [b.businessId])).rows;
    const { result } = await apply({ rows: [row(2, "Cross Med", { strength: "1 mg" })] });
    expect(result.import!.created_count).toBe(1); // new in A's catalog
    expect(await count(b)).toBe(bBefore);
    expect((await db.query(`select id, version from public.products where business_id = $1 order by id`, [b.businessId])).rows).toEqual(bRows);
    // B sees none of A's imports
    const seenByB = await asB(() => db.query(`select id from public.imports`));
    expect(seenByB.rows.map((r) => (r as { id: string }).id)).not.toContain(result.import!.id);
  });

  it("refuses a caller that has no business", async () => {
    const orphan = randomUUID();
    await db.query(`insert into auth.users (id, email) values ($1, 'orphan@example.test')`, [orphan]);
    await expect(
      withRole(db, "authenticated", orphan, () =>
        db.query(`select public.import_apply($1,'f.csv','csv','[]'::jsonb,'[]'::jsonb,'x','{}'::int[])`, [randomUUID()])),
    ).rejects.toThrow(/no_business/);
  });
});

describe("big lists", () => {
  it("classifies and imports 5,000 rows within seconds on the real engine", async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => row(i + 2, `Bulk ${i}`, { strength: `${i} mg`, selling_price: "10.00" }));
    const t0 = Date.now();
    const pv = await preview(rows);
    const { result } = await apply({ rows, fingerprint: pv.fingerprint });
    const ms = Date.now() - t0;
    expect(result.import!.created_count).toBe(5000);
    console.log(`PGlite 5,000-row preview + import: ${ms} ms`);
    expect(ms).toBeLessThan(30_000);
  });
});
