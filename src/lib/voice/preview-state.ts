import { newId } from "@/lib/ids";
import { cleanTypedName } from "@/lib/orders/editor-state";
import type { OrderLineInput } from "@/lib/orders/types";
import { normaliseQuantity } from "./quantity";
import type { Candidate, LineFlag, MatchState, ParserKind, Preview, StoreMatchState } from "./types";
import { VOICE_LIMITS } from "./types";

// The preview the supplier reviews and corrects before anything exists (pure; no I/O). Every rule about what is still
// doubtful, and when "Create draft order" is allowed, lives here, not in the components.

/** What the supplier decided for a line. A matched line starts as `catalog`; an unknown one starts as `typed`. */
export type LineChoice = { kind: "catalog"; productId: string; name: string; unit: string | null } | { kind: "typed" } | null;

export interface EditableLine {
  /** Stable key of the line inside this preview. */
  key: string;
  /** The order line id, made on the device so a retry is the same line. */
  lineId: string;
  spoken: string;
  state: MatchState;
  candidates: Candidate[];
  choice: LineChoice;
  quantity: number | null;
  unit: string | null;
  flags: LineFlag[];
  /** True once the supplier changed anything on the line (kept when parsing again). */
  touched: boolean;
}

export interface EditableStore {
  spoken: string | null;
  state: StoreMatchState;
  candidates: Candidate[];
  storeId: string | null;
  name: string | null;
  /** True once the supplier chose the store by hand (kept when parsing again). */
  touched?: boolean;
}

export interface PreviewState {
  /** The order and request ids, made once when the preview opens, so every create attempt is the same request. */
  orderId: string;
  requestId: string;
  parser: ParserKind;
  store: EditableStore;
  moreThanOneStore: boolean;
  unreadable: string[];
  lines: EditableLine[];
  /** The spoken names (normalised) of lines the supplier removed by hand, so parsing again does not bring them back. */
  removed?: string[];
}

/** Spoken names are compared without case, repeated spaces or surrounding spaces; Urdu script is kept as it is. */
export function normaliseSpoken(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function lineFromPreview(line: Preview["lines"][number]): EditableLine {
  let choice: LineChoice = null;
  if (line.state === "matched" && line.productId) {
    const found = line.candidates.find((c) => c.id === line.productId);
    choice = { kind: "catalog", productId: line.productId, name: found?.name ?? line.spoken, unit: found?.unit ?? null };
  } else if (line.state === "unknown") {
    choice = { kind: "typed" };
  }
  return {
    key: line.key,
    lineId: newId(),
    spoken: line.spoken,
    state: line.state,
    candidates: line.candidates,
    choice,
    quantity: line.quantity,
    unit: line.unit,
    flags: line.flags,
    touched: false,
  };
}

/** Builds the editable state from a preview; the order id and the request id are made here, once. */
export function stateFromPreview(preview: Preview): PreviewState {
  const store = preview.store;
  const matched = store.state === "matched" && store.storeId ? store.candidates.find((c) => c.id === store.storeId) : undefined;
  return {
    orderId: newId(),
    requestId: newId(),
    parser: preview.parser,
    store: {
      spoken: store.spoken,
      state: store.state,
      candidates: store.candidates,
      storeId: store.state === "matched" ? store.storeId : null,
      name: matched?.name ?? null,
    },
    moreThanOneStore: preview.more_than_one_store,
    unreadable: preview.unreadable,
    lines: preview.lines.map(lineFromPreview),
  };
}

export type PreviewAction =
  | { type: "choose_candidate"; key: string; candidate: Candidate }
  | { type: "choose_typed"; key: string }
  | { type: "set_quantity"; key: string; quantity: number | null }
  | { type: "set_unit"; key: string; unit: string }
  | { type: "remove_line"; key: string }
  | { type: "add_catalog_line"; product: Candidate }
  | { type: "add_typed_line"; name: string; quantity?: number | null; unit?: string | null }
  | { type: "choose_store"; store: { id: string; name: string } };

function mapLine(state: PreviewState, key: string, fn: (line: EditableLine) => EditableLine): PreviewState {
  return { ...state, lines: state.lines.map((line) => (line.key === key ? fn(line) : line)) };
}

let addedSeq = 0;
const newKey = () => `added-${(addedSeq += 1)}-${newId().slice(0, 8)}`;

/** The reducer. It never calls the AI and never saves anything. */
export function previewReducer(state: PreviewState, action: PreviewAction): PreviewState {
  switch (action.type) {
    case "choose_candidate":
      return mapLine(state, action.key, (line) => {
        const unitFlag = line.flags.includes("unit_not_heard") || !line.unit;
        return {
          ...line,
          choice: { kind: "catalog", productId: action.candidate.id, name: action.candidate.name, unit: action.candidate.unit ?? null },
          unit: unitFlag ? action.candidate.unit ?? line.unit : line.unit,
          flags: unitFlag && action.candidate.unit ? line.flags.filter((f) => f !== "unit_not_heard") : line.flags,
          touched: true,
        };
      });
    case "choose_typed":
      return mapLine(state, action.key, (line) => ({ ...line, choice: { kind: "typed" }, touched: true }));
    case "set_quantity":
      return mapLine(state, action.key, (line) => {
        const result = normaliseQuantity(action.quantity);
        const flags = line.flags.filter((f) => !f.startsWith("quantity_") && f !== "missing_quantity").concat(result.flags);
        return { ...line, quantity: result.quantity, flags, touched: true };
      });
    case "set_unit": {
      const unit = action.unit.replace(/\s+/g, " ").trim().slice(0, VOICE_LIMITS.unit);
      return mapLine(state, action.key, (line) => ({
        ...line,
        unit: unit === "" ? null : unit,
        flags: unit === "" ? line.flags : line.flags.filter((f) => f !== "unit_not_heard"),
        touched: true,
      }));
    }
    case "remove_line": {
      const gone = state.lines.find((line) => line.key === action.key);
      if (!gone) return state;
      const removed = new Set(state.removed ?? []);
      removed.add(normaliseSpoken(gone.spoken));
      return { ...state, lines: state.lines.filter((line) => line.key !== action.key), removed: [...removed] };
    }
    case "add_catalog_line": {
      if (state.lines.length >= VOICE_LIMITS.lines) return state;
      const line: EditableLine = {
        key: newKey(),
        lineId: newId(),
        spoken: action.product.name,
        state: "matched",
        candidates: [action.product],
        choice: { kind: "catalog", productId: action.product.id, name: action.product.name, unit: action.product.unit ?? null },
        quantity: null,
        unit: action.product.unit ?? null,
        flags: ["missing_quantity"],
        touched: true,
      };
      return { ...state, lines: [...state.lines, line] };
    }
    case "add_typed_line": {
      const name = cleanTypedName(action.name);
      if (state.lines.length >= VOICE_LIMITS.lines || name === "") return state;
      const quantity = normaliseQuantity(action.quantity ?? null);
      const unit = (action.unit ?? "").replace(/\s+/g, " ").trim().slice(0, VOICE_LIMITS.unit);
      const flags: LineFlag[] = [...quantity.flags];
      if (unit === "") flags.push("unit_not_heard");
      const line: EditableLine = {
        key: newKey(),
        lineId: newId(),
        spoken: name,
        state: "unknown",
        candidates: [],
        choice: { kind: "typed" },
        quantity: quantity.quantity,
        unit: unit === "" ? null : unit,
        flags,
        touched: true,
      };
      return { ...state, lines: [...state.lines, line] };
    }
    case "choose_store":
      return { ...state, store: { ...state.store, storeId: action.store.id, name: action.store.name, touched: true } };
    default:
      return state;
  }
}

/** True when the supplier changed anything by hand: a line, a removed line, an added line or the store. */
export function hasCorrections(state: PreviewState): boolean {
  return state.lines.some((line) => line.touched) || (state.removed?.length ?? 0) > 0 || state.store.touched === true;
}

/**
 * "Parse again, keep my corrections": every line the supplier touched is kept exactly as it is (with its ids); the lines
 * they did not touch are replaced by the new reading; a new line whose spoken name equals a kept line's, or one the
 * supplier removed, is dropped; a store chosen by hand is kept. The new order id and request id come from the new
 * reading, because the text changed. Lines that would go past the 200-line limit are not added, and their number is
 * returned so the screen can say so. Pure: no AI call, nothing is saved.
 */
export function mergeCorrections(current: PreviewState, fresh: PreviewState): { state: PreviewState; overLimit: number } {
  const kept = current.lines.filter((line) => line.touched);
  const blocked = new Set<string>([...kept.map((line) => normaliseSpoken(line.spoken)), ...(current.removed ?? [])]);
  const added: EditableLine[] = [];
  for (const line of fresh.lines) {
    const name = normaliseSpoken(line.spoken);
    if (blocked.has(name)) continue;
    // A new key, so no line of the new reading can share a key with a kept line (the reducer finds lines by key).
    added.push({ ...line, key: `${line.key}-r${newId().slice(0, 8)}` });
  }
  const room = Math.max(0, VOICE_LIMITS.lines - kept.length);
  const lines = [...kept, ...added.slice(0, room)];
  return {
    state: {
      ...fresh,
      store: current.store.touched ? current.store : fresh.store,
      lines,
      removed: current.removed ?? [],
    },
    overLimit: Math.max(0, added.length - room),
  };
}

export interface CanCreate {
  ok: boolean;
  /** The first thing still to do, in the supplier's words. Null when creating is allowed. */
  reason: string | null;
}

/** Create draft order is allowed only when nothing is doubtful. Returns the FIRST reason when it is not. */
export function canCreate(state: PreviewState): CanCreate {
  if (!state.store.storeId) return { ok: false, reason: "Choose the store for this order." };
  if (state.lines.length === 0) return { ok: false, reason: "Add at least one medicine." };
  if (state.lines.length > VOICE_LIMITS.lines) return { ok: false, reason: `An order can have at most ${VOICE_LIMITS.lines} lines.` };
  for (const line of state.lines) {
    if (line.choice === null) return { ok: false, reason: `Choose a medicine for "${line.spoken}", or choose "None of these".` };
    if (line.quantity === null) return { ok: false, reason: `Check the quantity of "${line.spoken}".` };
    if (line.choice.kind === "typed" && !(line.unit && line.unit.trim() !== "")) return { ok: false, reason: `Enter a unit for "${line.spoken}".` };
    if (line.choice.kind === "catalog" && !(line.unit && line.unit.trim() !== "")) return { ok: false, reason: `Enter a unit for "${line.spoken}".` };
  }
  return { ok: true, reason: null };
}

/** The lines of the save request. Call only when canCreate is ok. A typed line keeps the exact spoken text. */
export function toOrderLines(state: PreviewState): OrderLineInput[] {
  return state.lines.map((line) => {
    const catalog = line.choice?.kind === "catalog" ? line.choice : null;
    return {
      id: line.lineId,
      product_id: catalog ? catalog.productId : null,
      name: catalog ? null : cleanTypedName(line.spoken),
      quantity: line.quantity as number,
      unit: (line.unit ?? "").trim(),
    };
  });
}
