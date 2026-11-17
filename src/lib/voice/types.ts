// Shapes used by voice order entry (Module 008): what a parser returns, what the preview holds, and what the diagnostic
// log returns. They match specs/008-voice-order-gemini/data-model.md section 6 and contracts/api.openapi.yaml.
// No type here has a price, MRP, cost, balance or invoice field: the AI never receives one and no voice route returns one.

/** Which parser produced a result: the AI (Gemini) or the simple rule-based reader. */
export type ParserKind = "ai" | "rules";

/** One item as the parser heard it. The quantity is a number or null; whether it is usable is decided later. */
export interface RawItem {
  /** The product name as spoken. */
  name: string;
  quantity: number | null;
  unit: string | null;
}

/** The answer of either parser, before matching. */
export interface RawParse {
  /** The store name as spoken, or null when none was named. */
  store: string | null;
  items: RawItem[];
  /** Parts of the transcript the parser did not use (rule-based parser only; the AI answer has none). */
  unreadable: string[];
}

/** The state of a spoken store or medicine after matching by application code. */
export type MatchState = "matched" | "choose_one" | "unknown";
export type StoreMatchState = MatchState | "not_named";

/** A doubt about a line that the supplier must see (and, for the quantity flags, must resolve). */
export type LineFlag =
  | "missing_quantity"
  | "quantity_not_whole"
  | "quantity_too_small"
  | "quantity_too_large"
  | "unit_not_heard"
  | "duplicate_spoken";

/** One candidate record offered for a spoken name. Medicine candidates carry no price column. */
export interface Candidate {
  id: string;
  name: string;
  brand?: string | null;
  strength?: string | null;
  dosage_form?: string | null;
  manufacturer?: string | null;
  pack_size?: string | null;
  /** Medicines only. */
  unit?: string;
  /** Stores only. */
  contact_person?: string | null;
  phone?: string | null;
  /** True when the normalised spoken text equals the name (or a name form or the brand) exactly. */
  is_exact: boolean;
}

export interface StoreResolution {
  spoken: string | null;
  state: StoreMatchState;
  candidates: Candidate[];
  /** Set only when the state is matched. */
  storeId: string | null;
}

export interface PreviewLine {
  /** Stable key of the line inside one preview. */
  key: string;
  /** The product name exactly as the parser returned it. */
  spoken: string;
  state: MatchState;
  candidates: Candidate[];
  /** Set only when the state is matched. */
  productId: string | null;
  /** A whole number from 1 to 100,000, or null when it is missing or doubtful. */
  quantity: number | null;
  unit: string | null;
  flags: LineFlag[];
}

/** What the parse route returns and the preview screen edits. */
export interface Preview {
  parser: ParserKind;
  store: StoreResolution;
  more_than_one_store: boolean;
  lines: PreviewLine[];
  unreadable: string[];
}

export type DiagnosticKind =
  | "ai_busy"
  | "ai_timeout"
  | "ai_invalid"
  | "ai_not_configured"
  | "ai_unavailable"
  | "rate_limited"
  | "rules_unreadable"
  | "low_confidence";

export interface DiagnosticRecord {
  id: string;
  created_at: string;
  kind: DiagnosticKind;
  parser: ParserKind;
  item_count: number;
  doubtful_count: number;
  unreadable_count: number;
  transcript_length: number;
  message: string | null;
}

export interface DiagnosticPage {
  items: DiagnosticRecord[];
  total: number;
}

/** The limits shared by the screens, the schema and the tests. */
export const VOICE_LIMITS = {
  transcript: 2000,
  lines: 200,
  quantityMin: 1,
  quantityMax: 100000,
  unit: 50,
  name: 200,
  store: 200,
  candidates: 5,
  /** AI parses per business per minute. */
  parsesPerMinute: 20,
  /** The time limit of one AI parse, in milliseconds. */
  parseTimeoutMs: 15000,
} as const;
