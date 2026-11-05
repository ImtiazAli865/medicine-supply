import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";

// Runs the real migration on a real PostgreSQL engine (PGlite) with a Supabase-like role setup.
// Covers constraints, triggers, duplicate rules and Row Level Security without any credentials.

let db: PGlite;
let a: Tenant;
let b: Tenant;

const asA = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", a.userId, fn);
const asB = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", b.userId, fn);

async function insertStore(name: string, extra: Record<string, unknown> = {}) {
  const id = randomUUID();
  await db.query(`insert into public.stores (id, name, phone) values ($1, $2, $3)`, [id, name, extra.phone ?? null]);
  return id;
}

async function insertProduct(
  fields: Partial<Record<"name" | "unit" | "strength" | "dosage_form" | "pack_size" | "manufacturer" | "sku", string>> &
    { purchase_price?: string; selling_price?: string; mrp?: string } = {},
) {
  const id = randomUUID();
  await db.query(
    `insert into public.products (id, name, unit, strength, dosage_form, pack_size, manufacturer, sku, purchase_price, selling_price, mrp)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      fields.name ?? "Panadol",
      fields.unit ?? "strip",
      fields.strength ?? null,
      fields.dosage_form ?? null,
      fields.pack_size ?? null,
      fields.manufacturer ?? null,
      fields.sku ?? null,
      fields.purchase_price ?? null,
      fields.selling_price ?? null,
      fields.mrp ?? null,
    ],
  );
  return id;
}

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
  b = await createTenant(db, "b");
});

afterAll(async () => {
  await db.close();
});

describe("migration applies and guards every table", () => {
  it("has RLS enabled on every public table and business_id on every data table", async () => {
    const rows = await withRole(db, "service_role", null, async () => {
      const res = await db.query<{ table_name: string; rls_enabled: boolean; has_business_id: boolean }>(
        `select * from public.rls_audit()`,
      );
      return res.rows;
    });
    const names = rows.map((r) => r.table_name).sort();
    expect(names).toEqual(["business_settings", "businesses", "imports", "products", "profiles", "stores"]);
    for (const row of rows) {
      expect(row.rls_enabled, `${row.table_name} must have RLS enabled`).toBe(true);
      if (row.table_name !== "businesses" && row.table_name !== "profiles") {
        expect(row.has_business_id, `${row.table_name} must have business_id`).toBe(true);
      }
    }
  });

  it("only the service role may run the RLS audit", async () => {
    await expect(asA(() => db.query(`select * from public.rls_audit()`))).rejects.toThrow();
  });
});

describe("stores: required fields, defaults and idempotency", () => {
  it("creates a store with only a name; business_id comes from the caller, never the client", async () => {
    const id = randomUUID();
    await asA(() => db.query(`insert into public.stores (id, name) values ($1, 'Al Madina Medical')`, [id]));
    const row = await db.query<{ business_id: string; is_active: boolean; version: number }>(
      `select business_id, is_active, version from public.stores where id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({ business_id: a.businessId, is_active: true, version: 1 });
  });

  it("rejects an empty name and over-long fields", async () => {
    await expect(asA(() => db.query(`insert into public.stores (id, name) values ($1, '   ')`, [randomUUID()]))).rejects.toThrow();
    await expect(
      asA(() => db.query(`insert into public.stores (id, name, notes) values ($1, 'x', $2)`, [randomUUID(), "n".repeat(1001)])),
    ).rejects.toThrow();
  });

  it("rejects a repeated primary key (so retries cannot create a second row)", async () => {
    const id = randomUUID();
    await asA(() => db.query(`insert into public.stores (id, name) values ($1, 'Once')`, [id]));
    await expect(asA(() => db.query(`insert into public.stores (id, name) values ($1, 'Once')`, [id]))).rejects.toThrow(/duplicate key/);
    const count = await db.query<{ c: number }>(`select count(*)::int as c from public.stores where id = $1`, [id]);
    expect(count.rows[0].c).toBe(1);
  });
});

describe("products: constraints and duplicate rules", () => {
  it("creates a product with only name and unit, with no invented values", async () => {
    const id = randomUUID();
    await asA(() => db.query(`insert into public.products (id, name, unit) values ($1, 'Brufen', 'strip')`, [id]));
    const row = await db.query<Record<string, unknown>>(`select * from public.products where id = $1`, [id]);
    const p = row.rows[0];
    expect(p.purchase_price).toBeNull();
    expect(p.selling_price).toBeNull();
    expect(p.mrp).toBeNull();
    expect(p.strength).toBeNull();
    expect(p.manufacturer).toBeNull();
    expect(p.business_id).toBe(a.businessId);
  });

  it("stores money as exact NUMERIC(12,2) and rejects negatives", async () => {
    const id = await asA(() => insertProduct({ name: "Priced", purchase_price: "99.99", selling_price: "125.50", mrp: "130.00" }));
    const row = await db.query<{ p: string; s: string; m: string }>(
      `select purchase_price::text as p, selling_price::text as s, mrp::text as m from public.products where id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({ p: "99.99", s: "125.50", m: "130.00" });
    await expect(asA(() => insertProduct({ name: "Neg", selling_price: "-1" }))).rejects.toThrow(/check/);
  });

  it("blocks an exact duplicate ignoring case and spacing, even when the existing product is inactive", async () => {
    await asA(() => insertProduct({ name: "Panadol Extra", strength: "500 mg", dosage_form: "Tablet", pack_size: "10", manufacturer: "GSK" }));
    await expect(
      asA(() => insertProduct({ name: "  PANADOL   extra ", strength: "500  MG", dosage_form: "tablet", pack_size: "10", manufacturer: "gsk" })),
    ).rejects.toThrow(/products_identity_uniq/);

    await asA(() => db.query(`update public.products set is_active = false where name = 'Panadol Extra'`));
    await expect(
      asA(() => insertProduct({ name: "Panadol Extra", strength: "500 mg", dosage_form: "Tablet", pack_size: "10", manufacturer: "GSK" })),
    ).rejects.toThrow(/products_identity_uniq/);
  });

  it("does not treat the unit as part of the identity", async () => {
    await asA(() => insertProduct({ name: "Unit Test Syrup", unit: "bottle" }));
    await expect(asA(() => insertProduct({ name: "Unit Test Syrup", unit: "box" }))).rejects.toThrow(/products_identity_uniq/);
  });

  it("allows the same name with a different strength, dosage form or pack size (never merged)", async () => {
    await asA(() => insertProduct({ name: "Augmentin", strength: "375 mg" }));
    await asA(() => insertProduct({ name: "Augmentin", strength: "625 mg" }));
    await asA(() => insertProduct({ name: "Augmentin", strength: "625 mg", dosage_form: "Syrup" }));
    await asA(() => insertProduct({ name: "Augmentin", strength: "625 mg", pack_size: "6" }));
    const count = await db.query<{ c: number }>(`select count(*)::int as c from public.products where name = 'Augmentin'`);
    expect(count.rows[0].c).toBe(4);
  });

  it("enforces a unique SKU per business ignoring case, and allows many products without SKU", async () => {
    await asA(() => insertProduct({ name: "Sku One", sku: "ABC-1" }));
    await expect(asA(() => insertProduct({ name: "Sku Two", sku: " abc-1 " }))).rejects.toThrow(/products_sku_uniq/);
    await asA(() => insertProduct({ name: "No Sku One" }));
    await asA(() => insertProduct({ name: "No Sku Two" }));
  });

  it("allows the same product and SKU in a different business", async () => {
    await asB(() => insertProduct({ name: "Panadol Extra", strength: "500 mg", dosage_form: "Tablet", pack_size: "10", manufacturer: "GSK", sku: "ABC-1" }));
  });
});

describe("row bookkeeping: version, updated_at, immutability", () => {
  it("bumps version on every update and keeps created_at", async () => {
    const id = await asA(() => insertProduct({ name: "Versioned" }));
    const before = await db.query<{ created_at: string; version: number }>(`select created_at::text, version from public.products where id = $1`, [id]);
    await asA(() => db.query(`update public.products set brand = 'X' where id = $1`, [id]));
    await asA(() => db.query(`update public.products set brand = 'Y' where id = $1`, [id]));
    const after = await db.query<{ created_at: string; version: number }>(`select created_at::text, version from public.products where id = $1`, [id]);
    expect(before.rows[0].version).toBe(1);
    expect(after.rows[0].version).toBe(3);
    expect(after.rows[0].created_at).toBe(before.rows[0].created_at);
  });

  it("rejects changing id or business_id", async () => {
    const id = await asA(() => insertProduct({ name: "Immutable" }));
    await expect(asA(() => db.query(`update public.products set business_id = $1 where id = $2`, [b.businessId, id]))).rejects.toThrow();
    await expect(asA(() => db.query(`update public.products set id = $1 where id = $2`, [randomUUID(), id]))).rejects.toThrow(/immutable/);
  });

  it("ignores a client-supplied version on insert", async () => {
    const id = randomUUID();
    await asA(() => db.query(`insert into public.stores (id, name, version) values ($1, 'V', 99)`, [id]));
    const row = await db.query<{ version: number }>(`select version from public.stores where id = $1`, [id]);
    expect(row.rows[0].version).toBe(1);
  });
});

describe("search_text supports partial, case-insensitive, mixed-script matching", () => {
  it("finds products by name part, brand, generic name, strength, manufacturer and SKU", async () => {
    await asA(() =>
      db.query(
        `insert into public.products (id, name, unit, brand, generic_name, strength, manufacturer, sku)
         values ($1, 'Panadol Cold', 'strip', 'Panadol', 'Paracetamol', '500mg', 'GlaxoSmithKline', 'PAN-77')`,
        [randomUUID()],
      ),
    );
    await asA(() => db.query(`insert into public.products (id, name, unit) values ($1, 'پینا ڈول', 'strip')`, [randomUUID()]));
    for (const term of ["pan", "PARACET", "500mg", "glaxo", "pan-77", "ڈول"]) {
      const res = await asA(() =>
        db.query<{ name: string }>(`select name from public.products where search_text ilike $1`, [`%${term.toLowerCase()}%`]),
      );
      expect(res.rows.length, `term ${term}`).toBeGreaterThan(0);
    }
  });
});

describe("Row Level Security: two businesses never see each other", () => {
  let storeOfB: string;
  let productOfB: string;

  beforeAll(async () => {
    storeOfB = await asB(() => insertStore("Rehman Medical"));
    productOfB = await asB(() => insertProduct({ name: "B Secret Product", selling_price: "10.00" }));
  });

  it("A cannot list, read, update or deactivate B's rows", async () => {
    const stores = await asA(() => db.query(`select * from public.stores where id = $1`, [storeOfB]));
    expect(stores.rows).toHaveLength(0);
    const products = await asA(() => db.query(`select * from public.products where id = $1`, [productOfB]));
    expect(products.rows).toHaveLength(0);

    const upd = await asA(() => db.query(`update public.products set is_active = false, name = 'hacked' where id = $1`, [productOfB]));
    expect(upd.affectedRows).toBe(0);
    const updStore = await asA(() => db.query(`update public.stores set is_active = false where id = $1`, [storeOfB]));
    expect(updStore.affectedRows).toBe(0);

    const stillThere = await db.query<{ name: string; is_active: boolean }>(`select name, is_active from public.products where id = $1`, [productOfB]);
    expect(stillThere.rows[0]).toEqual({ name: "B Secret Product", is_active: true });

    const all = await asA(() => db.query<{ business_id: string }>(`select business_id from public.products`));
    expect(all.rows.every((r) => r.business_id === a.businessId)).toBe(true);
  });

  it("A cannot insert a row for B's business, nor move its own row to B", async () => {
    await expect(
      asA(() => db.query(`insert into public.stores (id, name, business_id) values ($1, 'Smuggled', $2)`, [randomUUID(), b.businessId])),
    ).rejects.toThrow(/row-level security/);
    const own = await asA(() => insertStore("Own store"));
    await expect(asA(() => db.query(`update public.stores set business_id = $1 where id = $2`, [b.businessId, own]))).rejects.toThrow();
  });

  it("no one can delete rows (records are deactivated, never removed)", async () => {
    const id = await asA(() => insertStore("Cannot delete me"));
    await expect(asA(() => db.query(`delete from public.stores where id = $1`, [id]))).rejects.toThrow(/permission denied/);
    await expect(asA(() => db.query(`delete from public.products`))).rejects.toThrow(/permission denied/);
  });

  it("signed-out (anon) callers get nothing", async () => {
    await expect(withRole(db, "anon", null, () => db.query(`select * from public.stores`))).rejects.toThrow(/permission denied/);
    await expect(withRole(db, "anon", null, () => db.query(`select * from public.products`))).rejects.toThrow(/permission denied/);
    await expect(
      withRole(db, "anon", null, () => db.query(`insert into public.stores (id, name) values ($1, 'x')`, [randomUUID()])),
    ).rejects.toThrow(/permission denied/);
  });

  it("each user sees only their own business and profile rows, and cannot write them", async () => {
    const biz = await asA(() => db.query<{ id: string }>(`select id from public.businesses`));
    expect(biz.rows.map((r) => r.id)).toEqual([a.businessId]);
    const prof = await asA(() => db.query<{ user_id: string }>(`select user_id from public.profiles`));
    expect(prof.rows.map((r) => r.user_id)).toEqual([a.userId]);
    await expect(asA(() => db.query(`update public.businesses set name = 'x'`))).rejects.toThrow(/permission denied/);
    await expect(asA(() => db.query(`insert into public.profiles (user_id, business_id) values ($1, $2)`, [randomUUID(), b.businessId]))).rejects.toThrow();
  });

  it("an account without a profile has no business and cannot create or read data", async () => {
    const orphan = await db.query<{ id: string }>(`insert into auth.users (email) values ('orphan@example.test') returning id`);
    const orphanId = orphan.rows[0].id;
    const cur = await withRole(db, "authenticated", orphanId, () => db.query<{ b: string | null }>(`select public.current_business_id() as b`));
    expect(cur.rows[0].b).toBeNull();
    await expect(
      withRole(db, "authenticated", orphanId, () => db.query(`insert into public.stores (id, name) values ($1, 'x')`, [randomUUID()])),
    ).rejects.toThrow();
    const seen = await withRole(db, "authenticated", orphanId, () => db.query(`select * from public.stores`));
    expect(seen.rows).toHaveLength(0);
  });
});
