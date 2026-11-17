import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertMedicine, insertStore } from "../helpers/pending-db";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";
import { dbMatchProducts, dbMatchStores, seedVoiceCatalog, type VoiceCatalog } from "../helpers/voice-db";

// voice_match_products and voice_match_stores on a real PostgreSQL engine: FACTS ONLY (up to five active candidates, an
// exact flag, a score), never a price; the matched-or-choose-one decision is made in application code.

let db: PGlite;
let a: Tenant;
let b: Tenant;
let catalog: VoiceCatalog;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "voice-match-a");
  b = await createTenant(db, "voice-match-b");
  catalog = await seedVoiceCatalog(db, a.businessId);
  await insertMedicine(db, b.businessId, { name: "Panadol", brand: "Panadol", strength: "500 mg", unit: "strip", purchase_price: "90.00", mrp: "130.00" });
  await insertStore(db, b.businessId, "Al Madina Medical");
}, 120_000);

afterAll(async () => {
  await db.close();
});

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();

describe("voice_match_products", () => {
  it("flags every medicine with the exact name as exact, and a longer name as not exact", async () => {
    const rows = await dbMatchProducts(db, a.userId, ["Panadol"]);
    const exact = rows.filter((r) => r.is_exact);
    expect(ids(exact)).toEqual([catalog.products.panadol500, catalog.products.panadol650].sort());
    // "Panadol Extra" may come back as a similar candidate, but never as exact
    expect(rows.find((r) => r.id === catalog.products.panadolExtra)?.is_exact ?? false).toBe(false);
  });

  it("is exact for the name with the strength, and for the name with the strength and the form", async () => {
    expect(ids((await dbMatchProducts(db, a.userId, ["Panadol 500 mg"])).filter((r) => r.is_exact))).toEqual([catalog.products.panadol500]);
    expect(ids((await dbMatchProducts(db, a.userId, ["Brufen 400 mg tablet"])).filter((r) => r.is_exact))).toEqual([catalog.products.brufen400]);
    expect(ids((await dbMatchProducts(db, a.userId, ["panadol   EXTRA"])).filter((r) => r.is_exact))).toEqual([catalog.products.panadolExtra]);
  });

  it("is exact for the brand", async () => {
    expect(ids((await dbMatchProducts(db, a.userId, ["Calpol"])).filter((r) => r.is_exact))).toEqual([catalog.products.calpol]);
  });

  it("returns both medicines when two differ only by manufacturer or pack size (nothing is merged)", async () => {
    const rows = await dbMatchProducts(db, a.userId, ["Augmentin 625"]);
    expect(ids(rows.filter((r) => r.is_exact))).toEqual([catalog.products.augmentinGsk, catalog.products.augmentinOther].sort());
    const detail = rows.map((r) => r.manufacturer).sort();
    expect(detail).toEqual(["GSK", "Other Pharma"]);
  });

  it("returns a near spelling as non-exact candidates", async () => {
    const rows = await dbMatchProducts(db, a.userId, ["Panadl"]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => !r.is_exact)).toBe(true);
    expect(rows.some((r) => r.id === catalog.products.panadol500)).toBe(true);
  });

  it("never returns an inactive medicine, and returns nothing for an unknown name, a blank name or an Urdu-script name", async () => {
    const rows = await dbMatchProducts(db, a.userId, ["Disprin", "Xyzzin", "   ", "پینا ڈول"]);
    expect(rows.filter((r) => r.idx === 0)).toHaveLength(0);
    expect(rows.filter((r) => r.idx === 1)).toHaveLength(0);
    expect(rows.filter((r) => r.idx === 2)).toHaveLength(0);
    expect(rows.filter((r) => r.idx === 3)).toHaveLength(0);
    expect(rows.some((r) => r.id === catalog.products.inactive)).toBe(false);
  });

  it("keeps each result with the index of its spoken name", async () => {
    const rows = await dbMatchProducts(db, a.userId, ["Brufen", "Calpol", "Augmentin 625"]);
    expect(new Set(rows.filter((r) => r.idx === 0).map((r) => r.id))).toEqual(new Set([catalog.products.brufen400, catalog.products.brufen200]));
    expect(rows.filter((r) => r.idx === 1).map((r) => r.id)).toEqual([catalog.products.calpol]);
    expect(rows.filter((r) => r.idx === 2)).toHaveLength(2);
  });

  it("returns at most five candidates for one name, exact ones first", async () => {
    for (let i = 0; i < 8; i += 1) {
      await insertMedicine(db, a.businessId, { name: "Zentel", brand: "Zentel", strength: `${100 + i} mg`, unit: "box" });
    }
    const rows = await dbMatchProducts(db, a.userId, ["Zentel"]);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.is_exact)).toBe(true);
  });

  it("caps the list at 200 names and ignores a non-list", async () => {
    const many = Array.from({ length: 205 }, () => "Calpol");
    const rows = await dbMatchProducts(db, a.userId, many);
    expect(Math.max(...rows.map((r) => r.idx))).toBe(199);
    await withRole(db, "authenticated", a.userId, async () => {
      const res = await db.query<{ n: string }>(`select count(*) as n from public.voice_match_products('{"not":"a list"}'::jsonb)`);
      expect(Number(res.rows[0].n)).toBe(0);
    });
  });

  it("returns only the caller's medicines: another business's medicines never appear, even by a crafted name", async () => {
    const own = await dbMatchProducts(db, b.userId, ["Panadol", "Brufen", "Calpol"]);
    expect(own).toHaveLength(1);
    expect(own[0].id).not.toBe(catalog.products.panadol500);
    expect((await dbMatchProducts(db, a.userId, ["Panadol"])).every((r) => r.id !== own[0].id)).toBe(true);
  });

  it("has no price, MRP, cost, margin or profit key in any row", async () => {
    const rows = await dbMatchProducts(db, b.userId, ["Panadol"]);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(Object.keys(row).join(" ")).not.toMatch(/purchase|mrp|cost|margin|profit|price/i);
    expect(JSON.stringify(rows)).not.toMatch(/90\.00|130\.00/);
  });
});

describe("voice_match_stores", () => {
  it("flags the exact store, returns near stores as not exact, and nothing for an unknown or blank name", async () => {
    const exact = await dbMatchStores(db, a.userId, "al madina   MEDICAL");
    expect(exact.filter((s) => s.is_exact).map((s) => s.id)).toEqual([catalog.stores.madina]);
    const near = await dbMatchStores(db, a.userId, "Madina");
    expect(ids(near)).toEqual([catalog.stores.madina, catalog.stores.madinaStore].sort());
    expect(near.every((s) => !s.is_exact)).toBe(true);
    expect(await dbMatchStores(db, a.userId, "Zzyzx Qwerty")).toHaveLength(0);
    // a shared common word ("Pharmacy") is only a similar, non-exact candidate: nothing is chosen for the supplier
    const generic = await dbMatchStores(db, a.userId, "Nowhere Pharmacy");
    expect(generic.every((s) => !s.is_exact)).toBe(true);
    expect(await dbMatchStores(db, a.userId, "   ")).toHaveLength(0);
  });

  it("never returns an inactive store or another business's store", async () => {
    await db.query(`update public.stores set is_active = false where id = $1`, [catalog.stores.shifa]);
    expect(await dbMatchStores(db, a.userId, "Al Shifa Pharmacy")).toHaveLength(0);
    const other = await dbMatchStores(db, b.userId, "Al Madina Medical");
    expect(other).toHaveLength(1);
    expect(other[0].id).not.toBe(catalog.stores.madina);
  });
});
