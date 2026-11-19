import { USUAL_MAX, type RepeatLine, type RepeatPlan, type SkippedLine, type SlimMedicine, type UsualMedicine } from "./fast-types";

// Pure rules for the usual medicines and the repeat plan (Module 008). No data access here.

const LINE_LIMIT = 200;

export interface QualifyingOrder {
  id: string;
  confirmed_at: string;
}

export interface UsualLine {
  order_id: string;
  product_id: string;
  quantity: number;
  unit: string;
  position: number;
}

export interface RankedUsual {
  product_id: string;
  order_count: number;
  last_ordered_at: string;
  last_quantity: number;
  last_unit: string;
}

function later(a: QualifyingOrder, b: QualifyingOrder): boolean {
  const ta = Date.parse(a.confirmed_at);
  const tb = Date.parse(b.confirmed_at);
  if (ta !== tb) return ta > tb;
  return a.id > b.id;
}

/**
 * Counts every medicine once per order and ranks them: most orders first, then the latest order, then id.
 * The quantity and unit come from the latest line of the latest order that contains the medicine.
 * Lines of orders that are not in `orders` are ignored. No cut is made here (inactive medicines are skipped later).
 */
export function rankUsual(orders: QualifyingOrder[], lines: UsualLine[]): RankedUsual[] {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const perProduct = new Map<string, { orders: Set<string>; latest: QualifyingOrder; line: UsualLine }>();
  for (const line of lines) {
    const order = byId.get(line.order_id);
    if (!order) continue;
    const entry = perProduct.get(line.product_id);
    if (!entry) {
      perProduct.set(line.product_id, { orders: new Set([order.id]), latest: order, line });
      continue;
    }
    entry.orders.add(order.id);
    if (entry.latest.id === order.id) {
      if (line.position > entry.line.position) entry.line = line;
    } else if (later(order, entry.latest)) {
      entry.latest = order;
      entry.line = line;
    }
  }
  return [...perProduct.entries()]
    .map(([product_id, e]) => ({
      product_id,
      order_count: e.orders.size,
      last_ordered_at: e.latest.confirmed_at,
      last_quantity: e.line.quantity,
      last_unit: e.line.unit,
    }))
    .sort((a, b) => {
      if (a.order_count !== b.order_count) return b.order_count - a.order_count;
      const ta = Date.parse(a.last_ordered_at);
      const tb = Date.parse(b.last_ordered_at);
      if (ta !== tb) return tb - ta;
      return a.product_id < b.product_id ? -1 : a.product_id > b.product_id ? 1 : 0;
    });
}

/** Takes the best active medicines from a ranked list; inactive and missing ones are skipped before the cut. */
export function pickUsual(ranked: RankedUsual[], active: Map<string, SlimMedicine>, max: number = USUAL_MAX): UsualMedicine[] {
  const picked: UsualMedicine[] = [];
  for (const r of ranked) {
    const medicine = active.get(r.product_id);
    if (!medicine) continue;
    picked.push({ medicine, order_count: r.order_count, last_ordered_at: r.last_ordered_at, last_quantity: r.last_quantity, last_unit: r.last_unit });
    if (picked.length >= max) break;
  }
  return picked;
}

export interface RepeatSourceLine {
  position: number;
  product_id: string | null;
  name: string;
  quantity: number;
  unit: string;
}

export type ProductLookup = Map<string, { medicine: SlimMedicine; active: boolean }>;

/**
 * Turns the lines of the source order into the lines of the new draft: catalog lines by medicine id, typed lines exactly
 * as typed, in the source order, at most 200. A medicine that is inactive or missing is listed, never dropped silently.
 * No price of any kind is read or copied.
 */
export function planRepeat(lines: RepeatSourceLine[], lookup: ProductLookup): RepeatPlan {
  const ordered = [...lines].sort((a, b) => a.position - b.position);
  const out: RepeatLine[] = [];
  const skipped: SkippedLine[] = [];
  for (const line of ordered) {
    if (line.product_id !== null) {
      const found = lookup.get(line.product_id);
      if (!found) {
        skipped.push({ name: line.name, reason: "missing" });
        continue;
      }
      if (!found.active) {
        skipped.push({ name: line.name, reason: "inactive" });
        continue;
      }
      if (out.length >= LINE_LIMIT) {
        skipped.push({ name: line.name, reason: "over_limit" });
        continue;
      }
      out.push({ kind: "catalog", medicine: found.medicine, quantity: line.quantity, unit: line.unit });
      continue;
    }
    if (out.length >= LINE_LIMIT) {
      skipped.push({ name: line.name, reason: "over_limit" });
      continue;
    }
    out.push({ kind: "typed", name: line.name, quantity: line.quantity, unit: line.unit });
  }
  return { lines: out, skipped };
}
