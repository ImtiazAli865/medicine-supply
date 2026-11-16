import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ENTRY_TYPE_LABEL, balanceWording } from "@/lib/accounts/status";
import type { LedgerEntry } from "@/lib/accounts/types";
import { formatInvoiceMoney } from "@/lib/invoices/status";

/** What an entry can be reversed with: a payment, an opening balance or an adjustment that is not already reversed. */
export function canReverse(entry: LedgerEntry): boolean {
  return entry.entry_type !== "invoice" && entry.entry_type !== "reversal" && !entry.reversed;
}

/** The second line of an entry: the invoice number, the reference or the reason, whichever the entry has. */
function detailOf(entry: LedgerEntry): string | null {
  if (entry.entry_type === "invoice") return entry.invoice_label;
  if (entry.entry_type === "payment") {
    const parts = [entry.invoice_label ? `Received with ${entry.invoice_label}` : null, entry.reference ? `Ref ${entry.reference}` : null].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  if (entry.entry_type === "reversal") return entry.note ? `Reason: ${entry.note}` : null;
  if (entry.entry_type === "adjustment") return entry.note ? `Reason: ${entry.note}` : null;
  return entry.note;
}

/**
 * One entry of a store account: type, date, what it relates to, the amount on its side and the running balance after
 * it. A reversed entry is marked; the Reverse action is offered only where the rules allow it.
 */
export function EntryRow({ entry, onReverse }: { entry: LedgerEntry; onReverse?: (entry: LedgerEntry) => void }) {
  const detail = detailOf(entry);
  const sign = entry.side === "debit" ? "+" : "−";
  return (
    <li
      className={`space-y-2 rounded-xl border border-border bg-surface px-4 py-3 ${entry.reversed ? "opacity-75" : ""}`}
      data-testid="entry-row"
      data-entry-type={entry.entry_type}
      data-reversed={entry.reversed ? "true" : "false"}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            <span data-testid="entry-type">{ENTRY_TYPE_LABEL[entry.entry_type]}</span>
            {entry.reversed ? <Badge tone="danger">Reversed</Badge> : null}
          </p>
          <p className="text-sm text-muted">{entry.entry_date}</p>
          {detail ? (
            <p className="break-words text-sm" dir="auto" data-testid="entry-detail">
              {entry.invoice_id && (entry.entry_type === "invoice" || entry.entry_type === "reversal") ? (
                <Link href={`/invoices/${entry.invoice_id}`} className="inline-flex min-h-11 items-center text-primary underline">
                  {detail}
                </Link>
              ) : (
                detail
              )}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold" data-testid="entry-amount" aria-label={`${entry.side === "debit" ? "Debit" : "Credit"} ${formatInvoiceMoney(entry.amount)}`}>
            {sign} {formatInvoiceMoney(entry.amount)}
          </p>
          {entry.running_balance !== undefined ? (
            <p className="text-sm text-muted" data-testid="entry-running">
              Balance: {balanceWording(entry.running_balance)}
            </p>
          ) : null}
        </div>
      </div>
      {onReverse && canReverse(entry) ? (
        <Button variant="secondary" data-testid="entry-reverse" onClick={() => onReverse(entry)}>
          Reverse
        </Button>
      ) : null}
    </li>
  );
}
