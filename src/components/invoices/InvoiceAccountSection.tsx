import Link from "next/link";
import { PaymentStatusBadge } from "@/components/invoices/PaymentStatusBadge";
import { accountUrl } from "@/lib/accounts/client";
import { NOT_IN_ACCOUNT_LABEL } from "@/lib/accounts/status";
import { formatInvoiceMoney } from "@/lib/invoices/status";
import type { Invoice } from "@/lib/invoices/types";

/**
 * What the store account says about an issued or cancelled invoice: its derived paid status with the amounts paid and
 * still unpaid, or a plain explanation when the invoice is not in the account (issued before the store accounts were
 * added). Always a link to the store account. Everything shown here comes from the server.
 */
export function InvoiceAccountSection({ invoice }: { invoice: Invoice }) {
  return (
    <section aria-label="Store account" className="space-y-2 rounded-xl border border-border bg-surface p-4" data-testid="invoice-account">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Store account</h2>
        <PaymentStatusBadge status={invoice.payment_status} inAccount={invoice.in_account} invoiceStatus={invoice.status} testId="invoice-payment-status" />
      </div>
      {invoice.status === "issued" && invoice.in_account && invoice.payment_status !== null ? (
        <dl className="grid grid-cols-2 gap-2 text-sm" data-testid="invoice-payment-amounts">
          <div>
            <dt className="text-muted">Paid so far</dt>
            <dd className="font-semibold" data-testid="invoice-amount-paid">
              {formatInvoiceMoney(invoice.amount_paid)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Still unpaid</dt>
            <dd className="font-semibold" data-testid="invoice-amount-outstanding">
              {formatInvoiceMoney(invoice.amount_outstanding)}
            </dd>
          </div>
        </dl>
      ) : null}
      {!invoice.in_account ? (
        <p className="text-sm text-muted" data-testid="invoice-not-in-account">
          {NOT_IN_ACCOUNT_LABEL}: this invoice was issued before store accounts were added, so it has no paid status and no Account Summary. Money for it is
          part of the opening balance you entered, if you entered one.
        </p>
      ) : invoice.status === "cancelled" ? (
        <p className="text-sm text-muted">This invoice was cancelled. Its entry and the reversal stay on the store account.</p>
      ) : null}
      <Link href={accountUrl(invoice.store.id)} className="inline-flex min-h-11 items-center text-primary underline" data-testid="invoice-account-link">
        Open the store account
      </Link>
    </section>
  );
}
