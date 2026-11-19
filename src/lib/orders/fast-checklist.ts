import { LIMITS, parseQuantity } from "./editor-state";
import type { RepeatLine } from "./fast-types";

// Pure rules of the "last order as a checklist" (Module 008, user story 6). No data access and no price anywhere.
// A row is a line of the source order, keyed by its position (the same medicine can be on the source order twice).

export const RANGE_TEXT = `Quantity must be a whole number from 1 to ${LIMITS.quantityMax.toLocaleString("en-US")}.`;

export interface ChecklistRow {
  /** Position of the line in the source order (0-based); unique per row. */
  index: number;
  line: RepeatLine;
  /** True when this catalog medicine is already on the order: the row cannot be selected (nothing is merged silently). */
  onOrder: boolean;
}

/** The selected rows: row index -> the quantity text being edited (it may be invalid for a moment). */
export type Selection = ReadonlyMap<number, string>;

export const EMPTY_SELECTION: Selection = new Map();

export function buildRows(lines: readonly RepeatLine[], onOrderIds: ReadonlySet<string>): ChecklistRow[] {
  return lines.map((line, index) => ({ index, line, onOrder: line.kind === "catalog" && onOrderIds.has(line.medicine.id) }));
}

/** Selects or unselects a row; a row that is on the order is never selected. A new selection starts at the last quantity. */
export function toggleRow(selection: Selection, row: ChecklistRow): Selection {
  if (row.onOrder) return selection;
  const next = new Map(selection);
  if (next.has(row.index)) next.delete(row.index);
  else next.set(row.index, String(row.line.quantity));
  return next;
}

/** Changes the quantity text of a selected row (an unselected row is left alone). */
export function setQuantityText(selection: Selection, index: number, text: string): Selection {
  if (!selection.has(index)) return selection;
  const next = new Map(selection);
  next.set(index, text);
  return next;
}

/** Selects every row that is not on the order; rows already selected keep the quantity the supplier typed. */
export function selectAll(rows: readonly ChecklistRow[], selection: Selection): Selection {
  const next = new Map(selection);
  for (const row of rows) if (!row.onOrder && !next.has(row.index)) next.set(row.index, String(row.line.quantity));
  return next;
}

/** Drops rows that are on the order now (after "Add selected") so they show "On order" and are no longer selected. */
export function pruneSelection(selection: Selection, rows: readonly ChecklistRow[]): Selection {
  const onOrder = new Set(rows.filter((r) => r.onOrder).map((r) => r.index));
  const next = new Map([...selection].filter(([index]) => !onOrder.has(index)));
  return next.size === selection.size ? selection : next;
}

export interface AddPlan {
  /** The lines to add, in the source order, with the chosen quantity and the unit of the source line. */
  lines: RepeatLine[];
  /** Rows whose quantity is not a whole number from 1 to 100,000. */
  invalid: number[];
  canAdd: boolean;
}

export function planAdd(rows: readonly ChecklistRow[], selection: Selection): AddPlan {
  const lines: RepeatLine[] = [];
  const invalid: number[] = [];
  for (const row of rows) {
    const text = selection.get(row.index);
    if (text === undefined || row.onOrder) continue;
    const quantity = parseQuantity(text);
    if (quantity === null) {
      invalid.push(row.index);
      continue;
    }
    lines.push({ ...row.line, quantity });
  }
  return { lines, invalid, canAdd: lines.length > 0 && invalid.length === 0 };
}
