import { Badge } from "@/components/ui/Badge";
import { NOT_IN_ACCOUNT_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/accounts/status";
import type { PaymentStatus } from "@/lib/accounts/types";
import type { InvoiceStatus } from "@/lib/invoices/types";

/**
 * The derived paid status of an issued invoice: Unpaid, Partly paid or Paid, or "Not in the account" for an invoice
 * issued before the store accounts were added. A draft and a cancelled invoice show nothing (they are never marked
 * paid). The status is worked out by the server from the ledger; nothing is stored or edited.
 */
export function PaymentStatusBadge({
  status,
  inAccount,
  invoiceStatus,
  testId,
}: {
  status: PaymentStatus | null;
  inAccount: boolean;
  invoiceStatus: InvoiceStatus;
  testId?: string;
}) {
  if (invoiceStatus !== "issued") return null;
  if (!inAccount || status === null) {
    return (
      <span data-testid={testId} data-payment-status="not_in_account">
        <Badge tone="neutral">{NOT_IN_ACCOUNT_LABEL}</Badge>
      </span>
    );
  }
  const tone = status === "paid" ? "success" : status === "partially_paid" ? "warning" : "danger";
  return (
    <span data-testid={testId} data-payment-status={status}>
      <Badge tone={tone}>{PAYMENT_STATUS_LABEL[status]}</Badge>
    </span>
  );
}
