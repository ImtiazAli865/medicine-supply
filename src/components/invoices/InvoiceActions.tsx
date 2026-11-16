"use client";

import { Printer } from "lucide-react";
import { useState } from "react";
import { CancelInvoiceDialog } from "@/components/invoices/CancelInvoiceDialog";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ClientApiError } from "@/lib/api/client";
import { invoicePrintUrl, postCancel } from "@/lib/invoices/client";
import type { Invoice } from "@/lib/invoices/types";

/**
 * The actions of an issued or cancelled invoice: print in either layout, and (for an issued invoice only) cancel it
 * with a reason. There is no edit and no delete: a mistake is corrected by cancelling and issuing a new invoice.
 */
export function InvoiceActions({ invoice, onInvoiceChange }: { invoice: Invoice; onInvoiceChange: (next: Invoice) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel(reason: string) {
    setBusy(true);
    setError(null);
    try {
      const { invoice: next } = await postCancel(invoice.id, reason);
      setOpen(false);
      onInvoiceChange(next);
    } catch (e) {
      setError(e instanceof ClientApiError ? (e.fields?.reason ?? e.message) : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2" data-testid="invoice-actions">
      <ButtonLink href={invoicePrintUrl(invoice.id, "a4")} testId="print-a4">
        <Printer size={18} aria-hidden="true" />
        Print A4
      </ButtonLink>
      <ButtonLink href={invoicePrintUrl(invoice.id, "thermal")} variant="secondary" testId="print-thermal">
        <Printer size={18} aria-hidden="true" />
        Print thermal
      </ButtonLink>
      {invoice.status === "issued" ? (
        <Button
          variant="secondary"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          data-testid="cancel-invoice"
        >
          Cancel invoice
        </Button>
      ) : null}
      <CancelInvoiceDialog
        open={open}
        label={invoice.number_label ?? "this invoice"}
        onClose={() => setOpen(false)}
        onConfirm={(reason) => void cancel(reason)}
        busy={busy}
        error={error}
        inAccount={invoice.in_account}
        paymentReceived={invoice.account_summary?.payment_received ?? null}
      />
    </div>
  );
}
