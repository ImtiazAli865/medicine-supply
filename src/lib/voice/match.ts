import { norm } from "@/lib/normalize";
import { normaliseQuantity, normaliseUnit } from "./quantity";
import type { Candidate, LineFlag, MatchState, PreviewLine, Preview, ParserKind, RawParse, StoreResolution } from "./types";
import { VOICE_LIMITS } from "./types";

// What a spoken store or medicine MEANS is decided here, by application code, never by the AI. The database only
// supplies candidate facts (voice_match_products, voice_match_stores). The rule is deliberately conservative:
//   matched    = exactly one candidate whose name equals the spoken text exactly;
//   choose one = any other non-empty candidate set (several strengths, forms, manufacturers or pack sizes, a near
//                spelling, a sound-alike): nothing is preselected;
//   unknown    = no candidate (the spoken text becomes a typed "Not registered" line).
// Pure functions; no I/O.

export function classifyMatch(candidates: Candidate[]): { state: MatchState; id: string | null } {
  const exact = candidates.filter((c) => c.is_exact);
  if (exact.length === 1) return { state: "matched", id: exact[0].id };
  if (candidates.length > 0) return { state: "choose_one", id: null };
  return { state: "unknown", id: null };
}

/** A candidate as the screen needs it: no score, no index, at most five of them, exact ones first. */
function cleanCandidates(rows: Array<Candidate & { score?: number; idx?: number }>): Candidate[] {
  return rows
    .slice(0, VOICE_LIMITS.candidates)
    .map(({ score: _score, idx: _idx, ...rest }) => {
      void _score;
      void _idx;
      return rest;
    });
}

/** True when the spoken store text looks like it names more than one store ("A, B", "A and B", "A aur B"). */
export function looksLikeSeveralStores(text: string | null): boolean {
  if (!text) return false;
  return /[,;]|\s(?:and|aur)\s/i.test(text);
}

export function resolveStore(spoken: string | null, rows: Array<Candidate & { score?: number }>): StoreResolution {
  const text = (spoken ?? "").replace(/\s+/g, " ").trim();
  if (text === "") return { spoken: null, state: "not_named", candidates: [], storeId: null };
  const candidates = cleanCandidates(rows);
  const { state, id } = classifyMatch(candidates);
  return { spoken: text, state, candidates, storeId: id };
}

export interface BuildInput {
  parser: ParserKind;
  raw: RawParse;
  /** Candidates for the spoken store (empty when no store was named). */
  storeRows: Array<Candidate & { score?: number }>;
  /** Candidates for every spoken product, each with the index of the item it belongs to. */
  productRows: Array<Candidate & { idx: number; score?: number }>;
}

/** Turns a parse and the candidate facts into the preview the supplier reviews. */
export function buildPreview(input: BuildInput): Preview {
  const store = resolveStore(input.raw.store, input.storeRows);
  const counts = new Map<string, number>();
  for (const item of input.raw.items) {
    const key = norm(item.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const lines: PreviewLine[] = input.raw.items.slice(0, VOICE_LIMITS.lines).map((item, index) => {
    const candidates = cleanCandidates(input.productRows.filter((row) => row.idx === index));
    const { state, id } = classifyMatch(candidates);
    const matched = id ? candidates.find((c) => c.id === id) : undefined;
    const quantity = normaliseQuantity(item.quantity);
    const unit = normaliseUnit(item.unit, matched?.unit);
    const flags: LineFlag[] = [...quantity.flags, ...unit.flags];
    if ((counts.get(norm(item.name)) ?? 0) > 1) flags.push("duplicate_spoken");
    return {
      key: `line-${index}`,
      spoken: item.name.replace(/\s+/g, " ").trim(),
      state,
      candidates,
      productId: id,
      quantity: quantity.quantity,
      unit: unit.unit,
      flags,
    };
  });

  return {
    parser: input.parser,
    store,
    more_than_one_store: store.state !== "matched" && looksLikeSeveralStores(input.raw.store),
    lines,
    unreadable: input.raw.unreadable,
  };
}
