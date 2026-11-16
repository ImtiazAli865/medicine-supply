import { absoluteMoney } from "@/lib/accounts/status";
import type { AccountSummarySnapshot } from "@/lib/accounts/types";
import { formatInvoiceMoney } from "@/lib/invoices/status";
import type { PrintLayout } from "@/lib/invoices/status";

/** A figure that can be an advance: a negative balance is written as "Advance PKR x" instead of a minus sign. */
function figure(value: string, isAdvance: boolean): string {
  const text = formatInvoiceMoney(absoluteMoney(value));
  return isAdvance ? `Advance ${text}` : text;
}

/**
 * The Account Summary block printed below the Grand Total. It shows only: Balance as on <date>, Previous Balance,
 * This Invoice, Payment Received (only when a payment was recorded at issue) and Balance Due. The five figures are the
 * snapshot saved when the invoice was issued; nothing is calculated here, and a payment recorded later never changes
 * them. There is no purchase price, MRP, cost or profit in it.
 */
export function AccountSummaryBlock({ summary, layout }: { summary: AccountSummarySnapshot; layout: PrintLayout }) {
  const thermal = layout === "thermal";
  return (
    <section
      aria-label="Account Summary"
      data-testid="account-summary"
      className={`break-inside-avoid space-y-1 border-t border-dashed border-black pt-2 ${thermal ? "text-[13px]" : "text-base"}`}
    >
      <h2 className={`font-bold ${thermal ? "text-sm" : "text-lg"}`}>Account Summary</h2>
      <p className="text-sm" data-testid="summary-date">
        Balance as on {summary.balance_date}
      </p>
      <dl className="space-y-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <dt>Previous Balance</dt>
          <dd data-testid="summary-previous">{figure(summary.previous_balance, summary.previous_is_advance)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt>This Invoice</dt>
          <dd data-testid="summary-invoice">{formatInvoiceMoney(summary.this_invoice)}</dd>
        </div>
        {summary.payment_received !== null ? (
          <div className="flex items-baseline justify-between gap-2">
            <dt>Payment Received</dt>
            <dd data-testid="summary-payment">{formatInvoiceMoney(summary.payment_received)}</dd>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-2 border-t border-black pt-0.5 font-bold">
          <dt>Balance Due</dt>
          <dd data-testid="summary-due">{figure(summary.balance_due, summary.due_is_advance)}</dd>
        </div>
      </dl>
    </section>
  );
}
