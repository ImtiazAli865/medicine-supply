"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { COLUMN_BY_KEY } from "@/lib/import/columns";
import type { PreviewRow, RawRow } from "@/lib/import/types";
import { useState } from "react";
import { STATUS_LABEL, STATUS_TONE } from "./status";

const PAGE = 100;

function reason(row: PreviewRow): string {
  switch (row.status) {
    case "exists":
      return `Already in your list${row.conflict ? ` as "${row.conflict.name}"` : ""}. It will be skipped.`;
    case "similar":
      return `Same name as "${row.conflict?.name ?? "an existing medicine"}" but different details. Skipped unless you choose to create it as a separate product.`;
    case "file_duplicate":
      return "Same medicine as an earlier row in this file. It will be skipped.";
    case "sku_used":
      return row.conflict ? `SKU already used by "${row.conflict.name}". It will be skipped.` : "SKU already used by an earlier row in this file. It will be skipped.";
    case "invalid":
      return `${row.field ? `${COLUMN_BY_KEY[row.field].label}: ` : ""}${row.message ?? "Invalid row."} It will be skipped.`;
    default:
      return "";
  }
}

const WARNING_TEXT = {
  selling_below_purchase: "Selling price is lower than the purchase price.",
  mrp_below_selling: "MRP is lower than the selling price.",
} as const;

/**
 * Paged list (100 rows at a time) so a 5,000-row preview never freezes a phone. The parent keys this
 * component by the active filter, which resets the page count when the filter changes.
 */
export function PreviewList({
  rows,
  raw,
  chosen,
  onToggle,
}: {
  rows: PreviewRow[];
  raw: Map<number, RawRow>;
  chosen: Set<number>;
  onToggle: (rowNo: number) => void;
}) {
  const [visible, setVisible] = useState(PAGE);
  const shown = rows.slice(0, visible);

  if (rows.length === 0) return <p className="py-6 text-center text-muted">No rows with this status.</p>;

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface" data-testid="preview-list">
        {shown.map((row) => {
          const cells = raw.get(row.row_no);
          const details = [cells?.strength, cells?.dosage_form, cells?.pack_size, cells?.manufacturer].filter(Boolean).join(" · ");
          return (
            <li key={row.row_no} data-testid={`preview-row-${row.row_no}`} data-status={row.status} className="space-y-1 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium" dir="auto">
                    <span className="text-sm text-muted">Row {row.row_no} · </span>
                    {cells?.name ?? "(no name)"}
                  </p>
                  {details ? <p className="text-sm text-muted" dir="auto">{details}</p> : null}
                </div>
                <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
              </div>
              {reason(row) ? <p className="text-sm">{reason(row)}</p> : null}
              {row.status === "new" || row.status === "similar" ? (
                !cells?.selling_price ? <p className="text-sm text-warning">No selling price. Add one later before invoicing.</p> : null
              ) : null}
              {(row.warnings ?? []).map((w) => (
                <p key={w} className="text-sm text-warning">{WARNING_TEXT[w]} You can still import it.</p>
              ))}
              {row.status === "similar" ? (
                <label className="flex min-h-11 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-6 shrink-0"
                    data-testid={`create-similar-${row.row_no}`}
                    checked={chosen.has(row.row_no)}
                    onChange={() => onToggle(row.row_no)}
                  />
                  <span className="text-base">Create as a separate product</span>
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>
      {visible < rows.length ? (
        <Button variant="secondary" className="w-full" onClick={() => setVisible((v) => v + PAGE)}>
          Show more ({(rows.length - visible).toLocaleString("en-US")} left)
        </Button>
      ) : null}
    </div>
  );
}
