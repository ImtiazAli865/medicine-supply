import { balanceWording } from "@/lib/accounts/status";
import type { PaymentPreview as Preview } from "@/lib/accounts/types";
import { formatInvoiceMoney } from "@/lib/invoices/status";

/**
 * What the payment would do, as the server worked it out: the balance after it and the items it settles, oldest
 * first. Nothing here is calculated in the browser. An amount that would leave an advance says so.
 */
export function PaymentPreview({ preview }: { preview: Preview }) {
  const advance = preview.advance_after !== "0.00" && preview.advance_after !== "";
  return (
    <section aria-label="What this payment will do" className="space-y-2 rounded-lg border border-border bg-slate-50 p-3" data-testid="payment-preview">
      <p data-testid="preview-after">
        Balance after this payment: <strong>{balanceWording(preview.balance_after)}</strong>
      </p>
      {advance ? (
        <p className="text-sm text-muted" data-testid="preview-advance">
          More than is owed: {formatInvoiceMoney(preview.advance_after)} is kept as an advance and settles the next invoice.
        </p>
      ) : null}
      {preview.settles.length > 0 ? (
        <ul className="space-y-1 text-sm" data-testid="preview-settles">
          {preview.settles.map((item, index) => (
            <li key={`${item.label}-${item.date}-${index}`} className="flex items-start justify-between gap-3" data-testid="preview-settle">
              <span className="min-w-0">
                {item.label} <span className="text-muted">({item.date})</span>
              </span>
              <span className="shrink-0 text-right">
                {formatInvoiceMoney(item.applied)}
                <span className="block text-muted">{item.outstanding_after === "0.00" ? "fully paid" : `${formatInvoiceMoney(item.outstanding_after)} left`}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nothing is unpaid to settle; the whole amount is kept as an advance.</p>
      )}
    </section>
  );
}
