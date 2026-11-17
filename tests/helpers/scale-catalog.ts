// A deterministic, realistic-looking catalog for the scale tests (Module 008, SC-009): 5,000 distinct pronounceable
// medicine names built from a seeded random generator, so a spoken name is similar to a handful of related names (a
// brand family, a near spelling) and not to thousands of unrelated rows. The same generator is used by the PGlite test
// and the Supabase test, so both measure the same catalog.

const CONSONANTS = ["b", "c", "d", "f", "g", "k", "l", "m", "n", "p", "r", "s", "t", "v", "x", "z", "br", "cl", "pr", "tr"];
const VOWELS = ["a", "e", "i", "o", "u", "ia", "eo"];
const ENDINGS = ["ol", "in", "ex", "ide", "one", "cin", "zole", "pam", "fen", "mol", "ril", "pril", "tan", "vir", "mab", "dine"];
const STRENGTHS = ["250 mg", "500 mg", "650 mg", "1 g", "5 mg", "10 mg", "20 mg"];
const FORMS = ["tablet", "capsule", "syrup", "injection"];

/** A small seeded random number generator (mulberry32): the same seed always gives the same numbers. */
function random(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ScaleMedicine {
  name: string;
  brand: string | null;
  strength: string;
  dosage_form: string;
  manufacturer: string;
}

let cache: ScaleMedicine[] | null = null;

/** The first `count` medicines of the catalog. Every name is different. */
function build(count: number): ScaleMedicine[] {
  const next = random(20261116);
  const pick = <T>(items: T[]): T => items[Math.floor(next() * items.length)];
  const seen = new Set<string>();
  const out: ScaleMedicine[] = [];
  while (out.length < count) {
    const syllables = 2 + Math.floor(next() * 2); // 2 or 3 syllables, then an ending
    let name = "";
    for (let i = 0; i < syllables; i += 1) name += pick(CONSONANTS) + pick(VOWELS);
    name += pick(ENDINGS);
    name = name.charAt(0).toUpperCase() + name.slice(1);
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const n = out.length;
    out.push({
      name,
      brand: n % 5 === 0 ? name : null,
      strength: STRENGTHS[n % STRENGTHS.length],
      dosage_form: FORMS[n % FORMS.length],
      manufacturer: `Maker ${String(n % 40).padStart(2, "0")}`,
    });
  }
  return out;
}

/** Medicine number n (0 to 4,999). */
export function scaleMedicine(n: number): ScaleMedicine {
  cache ??= build(5000);
  return cache[n];
}

/** A near spelling of a name (one letter left out): similar, never exact. */
export function nearSpelling(name: string): string {
  const cut = Math.max(2, Math.floor(name.length / 2));
  return name.slice(0, cut) + name.slice(cut + 1);
}

export const scaleStoreName = (n: number) => `Store ${String(n).padStart(3, "0")} Medical`;
