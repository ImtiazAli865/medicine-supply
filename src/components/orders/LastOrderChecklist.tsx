"use client";

import { Check, ListChecks } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { LoadingBlock } from "@/components/ui/Spinner";
import { ClientApiError } from "@/lib/api/client";
import { formatPakistanDateTime } from "@/lib/orders/dates";
import {
  buildRows,
  EMPTY_SELECTION,
  planAdd,
  pruneSelection,
  RANGE_TEXT,
  selectAll,
  setQuantityText,
  toggleRow,
  type ChecklistRow,
  type Selection,
} from "@/lib/orders/fast-checklist";
import type { RepeatLine, RepeatPlan, RepeatSource, SkippedLine } from "@/lib/orders/fast-types";
import { formatOrderNumber } from "@/lib/orders/number";

const REASON_TEXT: Record<SkippedLine["reason"], string> = {
  inactive: "no longer active",
  missing: "no longer in your catalog",
  over_limit: "did not fit in the 200-line limit",
};

function lineWord(count: number): string {
  return count === 1 ? "line" : "lines";
}

function nameOf(line: RepeatLine): string {
  return line.kind === "catalog" ? line.medicine.name : line.name;
}

function detailsOf(line: RepeatLine): string {
  if (line.kind === "typed") return "Not registered";
  const m = line.medicine;
  return [m.strength, m.dosage_form, m.pack_size, m.manufacturer].filter(Boolean).join(" · ");
}

function Row({
  row,
  text,
  onToggle,
  onQuantity,
}: {
  row: ChecklistRow;
  /** The quantity text when the row is selected, otherwise undefined. */
  text: string | undefined;
  onToggle: () => void;
  onQuantity: (value: string) => void;
}) {
  const selected = text !== undefined;
  const details = detailsOf(row.line);
  return (
    <li
      data-testid="checklist-row"
      data-selected={selected ? "true" : "false"}
      data-on-order={row.onOrder ? "true" : "false"}
      className={`flex items-stretch gap-2 rounded-lg border p-1 ${selected ? "border-primary bg-primary-soft" : "border-border bg-surface"} ${row.onOrder ? "opacity-70" : ""}`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-disabled={row.onOrder}
        disabled={row.onOrder}
        data-testid="checklist-toggle"
        onClick={onToggle}
        className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left"
      >
        <span
          aria-hidden="true"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border ${selected ? "border-primary bg-primary text-white" : "border-border bg-surface"}`}
        >
          {selected || row.onOrder ? <Check size={16} /> : null}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold" dir="auto">
            {nameOf(row.line)}
          </span>
          <span className="block truncate text-sm text-muted" dir="auto">
            {row.onOrder ? "On order · " : ""}
            {details}
            {details ? " · " : ""}
            {row.line.quantity} {row.line.unit}
          </span>
        </span>
      </button>
      {selected ? (
        <input
          aria-label={`Quantity of ${nameOf(row.line)}`}
          data-testid="checklist-quantity"
          inputMode="numeric"
          pattern="[0-9]*"
          value={text}
          aria-invalid={text !== undefined && planAdd([row], new Map([[row.index, text]])).invalid.length > 0}
          onChange={(e) => onQuantity(e.target.value)}
          className="min-h-11 w-20 shrink-0 self-center rounded-lg border border-border bg-surface px-2 py-2 text-center text-base"
        />
      ) : null}
    </li>
  );
}

/**
 * The last order of the store as a checklist: every line is a compact row, a tap selects it (the quantity can be changed),
 * and one "Add selected" puts all of them on the order in one change. Rows already on the order cannot be selected.
 * It reuses the read of "Repeat last order" and never copies a price.
 */
export function LastOrderChecklist({
  source,
  disabled,
  onOrderIds,
  fetchRepeat,
  onAdd,
}: {
  source: RepeatSource | null;
  disabled: boolean;
  /** Ids of the medicines already on the order. */
  onOrderIds: ReadonlySet<string>;
  fetchRepeat: (orderId: string) => Promise<RepeatPlan>;
  /** Adds all lines in one change; returns how many were added and how many did not fit. */
  onAdd: (lines: RepeatLine[], source: RepeatSource) => { added: number; refused: number };
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<RepeatPlan | null>(null);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [notAdded, setNotAdded] = useState<string[]>([]);
  const loading = useRef(false); // blocks a second load before React has re-rendered
  const adding = useRef(false);

  const rows = useMemo(() => (plan ? buildRows(plan.lines, onOrderIds) : []), [plan, onOrderIds]);
  // Rows that became "On order" (for example after Add selected) are no longer selected.
  const shown = useMemo(() => pruneSelection(selection, rows), [selection, rows]);
  const addPlan = useMemo(() => planAdd(rows, shown), [rows, shown]);

  if (!source) return null;

  async function load() {
    if (!source || loading.current) return;
    loading.current = true;
    setBusy(true);
    setError(null);
    try {
      setPlan(await fetchRepeat(source.order_id));
      setSelection(EMPTY_SELECTION);
      setNotAdded([]);
    } catch (e) {
      setError(e instanceof ClientApiError ? e.message : "The last order could not be loaded. Nothing was added.");
    } finally {
      loading.current = false;
      setBusy(false);
    }
  }

  function openList() {
    setOpen(true);
    if (!plan) void load();
  }

  function addSelected() {
    if (!source || !addPlan.canAdd || adding.current) return;
    adding.current = true;
    try {
      const { added, refused } = onAdd(addPlan.lines, source);
      setNotAdded(addPlan.lines.slice(added).slice(0, refused).map(nameOf));
      setSelection(EMPTY_SELECTION);
    } finally {
      adding.current = false;
    }
  }

  const invalid = new Set(addPlan.invalid);
  return (
    <section aria-label="Choose from last order" className="space-y-2" data-testid="checklist">
      {!open ? (
        <>
          <Button className="w-full" variant="secondary" onClick={openList} disabled={disabled} data-testid="checklist-open">
            <ListChecks size={20} aria-hidden="true" />
            Choose from last order
          </Button>
          <p className="text-sm text-muted" data-testid="checklist-source">
            {formatOrderNumber(source.order_number)} · {source.line_count} {lineWord(source.line_count)} · {formatPakistanDateTime(source.confirmed_at)}
          </p>
        </>
      ) : (
        <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">
              {formatOrderNumber(source.order_number)} · {formatPakistanDateTime(source.confirmed_at)}
            </h2>
            <Button variant="ghost" onClick={() => setOpen(false)} data-testid="checklist-close">
              Close
            </Button>
          </div>

          {busy && !plan ? <LoadingBlock label="Loading the last order…" /> : null}
          {error ? (
            <div data-testid="checklist-error">
              <ErrorState message={error} onRetry={load} />
            </div>
          ) : null}

          {plan && plan.skipped.length > 0 ? (
            <div role="status" data-testid="checklist-skipped" className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
              <p className="font-medium">
                {plan.skipped.length} {lineWord(plan.skipped.length)} {plan.skipped.length === 1 ? "is" : "are"} not on this list:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {plan.skipped.map((s, i) => (
                  <li key={`${s.name}:${i}`} dir="auto">
                    {s.name}: {REASON_TEXT[s.reason]}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {plan && rows.length === 0 && !error ? (
            <p data-testid="checklist-empty" className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted">
              Nothing from the last order can be chosen. Search for a medicine above.
            </p>
          ) : null}

          {rows.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setSelection(selectAll(rows, shown))} disabled={disabled} data-testid="checklist-all">
                  Select all
                </Button>
                <Button variant="secondary" onClick={() => setSelection(EMPTY_SELECTION)} disabled={shown.size === 0} data-testid="checklist-clear">
                  Clear
                </Button>
              </div>
              <ul className="space-y-1" data-testid="checklist-rows">
                {rows.map((row) => (
                  <Row
                    key={row.index}
                    row={row}
                    text={shown.get(row.index)}
                    onToggle={() => setSelection(toggleRow(shown, row))}
                    onQuantity={(value) => setSelection(setQuantityText(shown, row.index, value))}
                  />
                ))}
              </ul>
              {invalid.size > 0 ? (
                <p role="alert" className="text-sm text-danger" data-testid="checklist-range">
                  {RANGE_TEXT}
                </p>
              ) : null}
              {notAdded.length > 0 ? (
                <p role="status" className="text-sm text-warning" data-testid="checklist-not-added">
                  These did not fit in the 200-line limit and were not added: {notAdded.join(", ")}.
                </p>
              ) : null}
              <Button className="w-full" onClick={addSelected} disabled={disabled || !addPlan.canAdd} data-testid="checklist-add">
                {addPlan.lines.length > 0 ? `Add ${addPlan.lines.length} selected` : "Add selected"}
              </Button>
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
