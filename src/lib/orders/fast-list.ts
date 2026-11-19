import { normalizeRow, type SearchRow } from "./fast-search";
import type { SlimMedicine } from "./fast-types";

// The state of the medicine list that is loaded when the order screen opens (Module 008, research D3). Pure reducer.
// The list is a copy for searching only. Only a COMPLETE list (status "ready") may be filtered on the device: a partial
// list would hide medicines, so while loading, after an error, or when the catalog is too large, the server search is used.

export const PAGE_SIZE = 900;
export const MAX_MEDICINES = 6000;

export type ListStatus = "loading" | "ready" | "too_large" | "error";

export interface ListState {
  status: ListStatus;
  /** Rows loaded so far (empty again when the list is too large). */
  rows: SearchRow[];
  /** The cursor of the next page while loading. */
  next: string | null;
  error: string | null;
  /** Which load these rows belong to; an answer of an older load is ignored. */
  loadId: number;
}

export type ListAction =
  | { type: "start"; loadId: number }
  | { type: "page"; loadId: number; items: SlimMedicine[]; next: string | null }
  | { type: "fail"; loadId: number; message: string };

export function initialListState(loadId = 0): ListState {
  return { status: "loading", rows: [], next: null, error: null, loadId };
}

export function listReducer(state: ListState, action: ListAction): ListState {
  switch (action.type) {
    case "start":
      return initialListState(action.loadId);
    case "page": {
      if (action.loadId !== state.loadId || state.status !== "loading") return state;
      // The offset cursor can repeat a row if the catalog changes while paging, so a row already loaded is dropped.
      const have = new Set(state.rows.map((r) => r.medicine.id));
      const added = action.items.filter((m) => !have.has(m.id)).map(normalizeRow);
      const rows = [...state.rows, ...added];
      if (rows.length > MAX_MEDICINES) return { ...state, status: "too_large", rows: [], next: null, error: null };
      if (action.next === null) return { ...state, status: "ready", rows, next: null, error: null };
      return { ...state, rows, next: action.next };
    }
    case "fail":
      if (action.loadId !== state.loadId) return state;
      return { ...state, status: "error", error: action.message, next: null };
  }
}

/** True when typing must be answered by the server search instead of the device list. */
export function needsServerSearch(state: ListState): boolean {
  return state.status !== "ready";
}
