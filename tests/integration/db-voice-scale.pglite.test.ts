import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import { nearSpelling, scaleMedicine } from "../helpers/scale-catalog";
import { dbMatchProducts, type MatchRow } from "../helpers/voice-db";

// Matching a long spoken order against a large catalog (success criterion SC-009) on a real PostgreSQL engine, and proof
// that the fast version (migration 0010) answers what the plain definition answers: the same candidates with the same
// exactness and scores in the same order (the only allowed difference: which of several EQUALLY similar names fills the
// last place). The reference below is the plain definition (compare every spoken name with every medicine).

let db: PGlite;
let a: Tenant;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "voice-scale-pglite");
  const rows = Array.from({ length: 5000 }, (_, n) => scaleMedicine(n));
  await db.query(
    `insert into public.products (id, business_id, name, brand, strength, dosage_form, manufacturer, unit)
     select gen_random_uuid(), $1, t.name, t.brand, t.strength, t.form, t.maker, 'strip'
       from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) as t(name, brand, strength, form, maker)`,
    [a.businessId, rows.map((r) => r.name), rows.map((r) => r.brand), rows.map((r) => r.strength), rows.map((r) => r.dosage_form), rows.map((r) => r.manufacturer)],
  );
  // a few likenesses that matter: one name in several strengths, and one name from two makers
  await db.query(
    `insert into public.products (id, business_id, name, brand, strength, dosage_form, manufacturer, unit) values
       (gen_random_uuid(), $1, 'Panadol', 'Panadol', '500 mg', 'tablet', 'GSK', 'strip'),
       (gen_random_uuid(), $1, 'Panadol', 'Panadol', '650 mg', 'tablet', 'GSK', 'strip'),
       (gen_random_uuid(), $1, 'Panadol Extra', 'Panadol Extra', '500 mg', 'tablet', 'GSK', 'strip'),
       (gen_random_uuid(), $1, 'Augmentin 625', 'Augmentin', '625 mg', 'tablet', 'GSK', 'box'),
       (gen_random_uuid(), $1, 'Augmentin 625', 'Augmentin', '625 mg', 'tablet', 'Other Pharma', 'box')`,
    [a.businessId],
  );
}, 300_000);

afterAll(async () => {
  await db.close();
});

/** The plain definition: every spoken name against every active medicine of the business. */
async function reference(names: string[], perName = 5): Promise<MatchRow[]> {
  const res = await db.query<MatchRow>(
    `with spoken as (
       select (t.ord - 1)::integer as idx, public.norm_text(t.val) as q
         from jsonb_array_elements_text($1::jsonb) with ordinality as t(val, ord) where t.ord <= 200
     ),
     cand as (
       select s.idx, p.id, p.name, p.brand, p.strength, p.dosage_form, p.manufacturer, p.pack_size, p.unit,
              (public.norm_text(p.name) = s.q
               or public.norm_text(p.name || ' ' || coalesce(p.strength, '')) = s.q
               or public.norm_text(p.name || ' ' || coalesce(p.strength, '') || ' ' || coalesce(p.dosage_form, '')) = s.q
               or (p.brand is not null and public.norm_text(p.brand) = s.q)) as is_exact,
              extensions.word_similarity(s.q, p.search_text) as score
         from spoken s join public.products p on p.business_id = $2 and p.is_active
        where s.q <> ''
     ),
     ranked as (
       select c.*, row_number() over (partition by c.idx order by c.is_exact desc, c.score desc, c.name, c.id) as rn
         from cand c where c.is_exact or c.score >= 0.3
     )
     select r.idx, r.id, r.name, r.brand, r.strength, r.dosage_form, r.manufacturer, r.pack_size, r.unit, r.is_exact, r.score
       from ranked r where r.rn <= $3 order by r.idx, r.rn`,
    [JSON.stringify(names), a.businessId, perName],
  );
  return res.rows;
}

const sig = (r: MatchRow) => `${r.is_exact}|${Number(r.score).toFixed(4)}`;

/**
 * The fast version and the plain definition must show the same candidates, except that among several names that are
 * EQUALLY similar at the last place either may be shown (the order among equals is arbitrary), and that a name with an exact
 * match lists only its exact matches. So: for every spoken name the
 * sequence of (exact, score) is identical; a group of equal scores that is shown completely has identical members; a group
 * that was cut off at the fifth place shows members that all belong to the plain definition's group.
 */
async function expectSameUpToTies(names: string[], mine: MatchRow[]): Promise<void> {
  const everything = await reference(names, 100000);
  // A name with an exact match is shown with its exact matches only (the similar ones are searched for only when there is no
  // exact match), so the plain definition's rows are narrowed the same way before they are compared.
  const hasExact = new Set(everything.filter((r) => r.is_exact).map((r) => r.idx));
  const narrow = (rows: MatchRow[]) => rows.filter((r) => !hasExact.has(r.idx) || r.is_exact);
  const plain = narrow(await reference(names));
  const plainAll = narrow(everything);
  const indexes = new Set([...mine.map((r) => r.idx), ...plain.map((r) => r.idx)]);
  for (const idx of indexes) {
    const m = mine.filter((r) => r.idx === idx);
    const p = plain.filter((r) => r.idx === idx);
    const all = plainAll.filter((r) => r.idx === idx);
    expect(m.map(sig), `name ${idx}`).toEqual(p.map(sig));
    expect(new Set(m.map((r) => r.id)).size, `name ${idx}`).toBe(m.length);
    for (const group of new Set(m.map(sig))) {
      const shown = m.filter((r) => sig(r) === group).map((r) => r.id).sort();
      const everyOne = all.filter((r) => sig(r) === group).map((r) => r.id).sort();
      if (shown.length === everyOne.length) expect(shown, `name ${idx} group ${group}`).toEqual(everyOne);
      else expect(shown.every((id) => everyOne.includes(id)), `name ${idx} group ${group}`).toBe(true);
    }
  }
}

const one = scaleMedicine(17);
const two = scaleMedicine(18);
const three = scaleMedicine(20);
const four = scaleMedicine(42);

const SAMPLE = [
  "Panadol", // two strengths, both exact
  "panadol  500 mg", // name and strength
  "Panadol 500 mg tablet", // name, strength and form
  "Panadl", // near spelling
  "Panadol Extra",
  "Augmentin 625", // two makers
  "Augmentin", // brand only
  scaleMedicine(5).name, // brand exact (n % 5 = 0)
  one.name,
  `${two.name} ${two.strength}`,
  `${three.name} ${three.strength} ${three.dosage_form}`,
  nearSpelling(four.name), // near spelling of one of 5,000
  "mg tablet", // very common words
  "zzyzx qwerty", // nothing like it
  "", // empty
  "پینا ڈول", // Urdu script
  "  ",
];

describe("matching a long spoken order against 5,000 medicines", () => {
  it("answers what the plain definition answers: the same candidates, up to ties at the last place", async () => {
    const mine = await dbMatchProducts(db, a.userId, SAMPLE);
    await expectSameUpToTies(SAMPLE, mine);
    expect(mine.length).toBeGreaterThan(5);
    // the cases the plain definition decides are really present: two exact strengths of one name, a near spelling, a brand
    expect(mine.filter((r) => r.idx === 0 && r.is_exact)).toHaveLength(2);
    expect(mine.filter((r) => r.idx === 3).length).toBeGreaterThan(0);
    expect(mine.filter((r) => r.idx === 3).every((r) => r.is_exact === false)).toBe(true);
    expect(mine.filter((r) => r.idx === 7 && r.is_exact).length).toBeGreaterThan(0);
  }, 120_000);

  it("matches 200 spoken names without scanning the whole catalog for every name (regression guard)", async () => {
    // PGlite is single-threaded WebAssembly and several times slower than a PostgreSQL server, so the 2-second goal of
    // SC-009 is asserted on the real test project (voice-scale.test.ts). Here the bound only catches the old behaviour
    // (a full scan with a similarity computation for every name), which took more than 35 seconds on this engine.
    const names = Array.from({ length: 200 }, (_, i) => (i % 4 === 0 ? nearSpelling(scaleMedicine(1 + i * 24).name) : scaleMedicine(1 + i * 24).name));
    await dbMatchProducts(db, a.userId, names); // the first call loads the index pages
    const started = performance.now();
    const rows = await dbMatchProducts(db, a.userId, names);
    const ms = Math.round(performance.now() - started);
    expect(new Set(rows.map((r) => r.idx)).size).toBeGreaterThan(150);
    expect(ms, `200 names took ${ms} ms`).toBeLessThan(20_000);
  }, 300_000);

  it("a long spoken order gives the same answer as the plain definition, up to ties at the last place", async () => {
    // 60 names: the plain definition scans the whole catalog for every name, so it is slow on this engine
    const names = Array.from({ length: 60 }, (_, i) => (i % 4 === 0 ? nearSpelling(scaleMedicine(1 + i * 24).name) : scaleMedicine(1 + i * 24).name));
    const mine = await dbMatchProducts(db, a.userId, names);
    await expectSameUpToTies(names, mine);
    const exact = mine.filter((r) => r.is_exact);
    expect(new Set(exact.map((r) => r.idx)).size).toBe(45);
  }, 300_000);
});
