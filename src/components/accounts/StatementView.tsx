import { ENTRY_TYPE_LABEL, balanceWording } from "@/lib/accounts/status";
import type { LedgerEntry, Statement } from "@/lib/accounts/types";
import { formatInvoiceMoney } from "@/lib/invoices/status";

function detailOf(entry: LedgerEntry): string {
  const parts: string[] = [];
  if (entry.invoice_label) parts.push(entry.entry_type === "payment" ? `Received with ${entry.invoice_label}` : entry.invoice_label);
  if (entry.reference) parts.push(`Ref ${entry.reference}`);
  if (entry.note) parts.push(entry.entry_type === "reversal" || entry.entry_type === "adjustment" ? `Reason: ${entry.note}` : entry.note);
  if (entry.reversed) parts.push("Reversed");
  return parts.join(" · ");
}

const money = (value: string) => (value === "0.00" ? "" : formatInvoiceMoney(value));

/**
 * The Store Statement: the balance on the start date, every entry of the range with the balance after it, the totals
 * and the closing balance. It has no purchase price, MRP, cost, margin or profit, because the account has none.
 * Printable on A4.
 */
export function StatementView({ statement }: { statement: Statement }) {
  return (
    <article className="space-y-4 rounded-xl border border-border bg-surface p-4 print:border-0 print:p-0" data-testid="statement">
      <header className="space-y-1">
        <p className="text-lg font-semibold" dir="auto" data-testid="statement-business">
          {statement.business.name}
        </p>
        {statement.business.phone ? <p className="text-sm text-muted">{statement.business.phone}</p> : null}
        {statement.business.address ? (
          <p className="text-sm text-muted" dir="auto">
            {statement.business.address}
          </p>
        ) : null}
        <h1 className="pt-2 text-2xl font-semibold">Store Statement</h1>
        <p className="font-medium" dir="auto" data-testid="statement-store">
          {statement.store.name}
        </p>
        <p className="text-sm text-muted" data-testid="statement-range">
          {statement.from} to {statement.to}
        </p>
      </header>

      <p className="flex items-center justify-between gap-3 border-y border-border py-2 font-medium" data-testid="statement-opening">
        <span>Balance before {statement.from}</span>
        <span>{balanceWording(statement.opening_balance)}</span>
      </p>

      {statement.entries.length === 0 ? (
        <p className="py-2 text-muted" data-testid="statement-empty">
          No entries between these dates.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-left text-sm" data-testid="statement-table">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="py-2 pr-2 font-medium">Date</th>
                <th className="py-2 pr-2 font-medium">Entry</th>
                <th className="py-2 pr-2 text-right font-medium">Debit</th>
                <th className="py-2 pr-2 text-right font-medium">Credit</th>
                <th className="py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {statement.entries.map((entry) => {
                const detail = detailOf(entry);
                return (
                  <tr key={entry.id} className="border-b border-border align-top" data-testid="statement-row" data-entry-type={entry.entry_type}>
                    <td className="whitespace-nowrap py-2 pr-2">{entry.entry_date}</td>
                    <td className="py-2 pr-2">
                      <span className="block font-medium">{ENTRY_TYPE_LABEL[entry.entry_type]}</span>
                      {detail ? (
                        <span className="block break-words text-muted" dir="auto">
                          {detail}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-2 text-right">{money(entry.debit)}</td>
                    <td className="whitespace-nowrap py-2 pr-2 text-right">{money(entry.credit)}</td>
                    <td className="whitespace-nowrap py-2 text-right">{entry.running_balance !== undefined ? balanceWording(entry.running_balance) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {statement.truncated ? (
        <p role="status" className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm" data-testid="statement-truncated">
          This range has more than 2,000 entries, so only the first 2,000 are listed. Choose a shorter range to see the rest. The totals below cover the
          whole range.
        </p>
      ) : null}

      <dl className="space-y-1 border-t border-border pt-2" data-testid="statement-totals">
        <div className="flex justify-between gap-3">
          <dt>Total debit</dt>
          <dd data-testid="statement-total-debit">{formatInvoiceMoney(statement.total_debit)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Total credit</dt>
          <dd data-testid="statement-total-credit">{formatInvoiceMoney(statement.total_credit)}</dd>
        </div>
        <div className="flex justify-between gap-3 text-lg font-semibold">
          <dt>Balance on {statement.to}</dt>
          <dd data-testid="statement-closing">{balanceWording(statement.closing_balance)}</dd>
        </div>
      </dl>
    </article>
  );
}
