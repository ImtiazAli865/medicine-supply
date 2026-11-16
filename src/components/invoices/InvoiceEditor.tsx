"use client";

import { ChevronLeft, Printer, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DiscardDraftDialog } from "@/components/invoices/DiscardDraftDialog";
import { InvoiceBlockers } from "@/components/invoices/InvoiceBlockers";
import { InvoiceHistory } from "@/components/invoices/InvoiceHistory";
import { InvoiceLineRow, parseDelivered } from "@/components/invoices/InvoiceLineRow";
import { IssueInvoiceDialog } from "@/components/invoices/IssueInvoiceDialog";
import { StaleNotice } from "@/components/invoices/StaleNotice";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Banner } from "@/components/ui/States";
import { ClientApiError } from "@/lib/api/client";
import { getInvoice, invoicePrintUrl, patchQuantities, postDiscard, postIssue, postRefresh } from "@/lib/invoices/client";
import { formatInvoiceMoney } from "@/lib/invoices/status";
import type { Invoice } from "@/lib/invoices/types";
import { compareMoney, isValidMoney } from "@/lib/money";
import { formatOrderNumber } from "@/lib/orders/number";

function messageOf(error: unknown): string {
  return error instanceof ClientApiError ? error.message : "Something went wrong. Please try again.";
}

/**
 * A draft invoice: the lines copied from the order, a delivered (billed) quantity per line, the totals the server
 * calculated, and the steps to issue or discard it. Totals are never calculated here: they update after a save.
 * The parent gives this component a key that includes the invoice version, so a newer invoice resets the inputs.
 */
export function InvoiceEditor({ invoice, onInvoiceChange }: { invoice: Invoice; onInvoiceChange: (next: Invoice) => void }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(invoice.lines.map((l) => [l.id, String(l.delivered_quantity)])));
  const [busy, setBusy] = useState<null | "save" | "refresh" | "issue" | "discard">(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Invoice | null>(null);
  const [dialog, setDialog] = useState<null | "issue" | "discard">(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [payment, setPayment] = useState("");
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const parsed = invoice.lines.map((line) => ({ line, next: parseDelivered(values[line.id] ?? "") }));
  const invalid = parsed.some((p) => p.next === null);
  const changed = parsed.filter((p) => p.next !== null && p.next !== p.line.delivered_quantity);
  const dirty = changed.length > 0 || invalid;
  const orderConfirmed = invoice.order_status === "confirmed";
  const billedLines = invoice.lines.filter((l) => l.billed).length;

  function handleFailure(e: unknown, where: "page" | "dialog") {
    if (e instanceof ClientApiError && e.code === "version_conflict" && e.current) {
      setConflict(e.current as Invoice);
      if (where === "dialog") setDialog(null);
      return;
    }
    if (where === "dialog") setDialogError(messageOf(e));
    else setError(messageOf(e));
  }

  async function save() {
    if (invalid || changed.length === 0) return;
    setBusy("save");
    setError(null);
    try {
      const { invoice: next } = await patchQuantities(
        invoice.id,
        invoice.version,
        changed.map((p) => ({ line_id: p.line.id, delivered_quantity: p.next as number })),
      );
      onInvoiceChange(next);
    } catch (e) {
      handleFailure(e, "page");
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    setBusy("refresh");
    setError(null);
    try {
      const { invoice: next } = await postRefresh(invoice.id, invoice.version);
      onInvoiceChange(next);
    } catch (e) {
      handleFailure(e, "page");
    } finally {
      setBusy(null);
    }
  }

  async function issue() {
    const typed = payment.trim();
    if (typed !== "" && (!isValidMoney(typed) || (compareMoney(typed, "0") ?? 0) <= 0)) {
      setPaymentError("Enter an amount above 0 with at most two decimals.");
      return;
    }
    setPaymentError(null);
    setBusy("issue");
    setDialogError(null);
    try {
      const { invoice: next } = await postIssue(invoice.id, invoice.version, typed === "" ? null : typed);
      setDialog(null);
      onInvoiceChange(next);
    } catch (e) {
      if (e instanceof ClientApiError && e.fields?.payment_received) {
        setPaymentError(e.fields.payment_received);
        return;
      }
      if (e instanceof ClientApiError && (e.code === "order_changed" || e.code === "not_ready" || e.code === "nothing_to_bill" || e.code === "order_not_confirmed")) {
        setDialog(null);
        setError(e.message);
        // The draft may be stale or blocked: reload it so the notices are right.
        try {
          onInvoiceChange(await getInvoice(invoice.id));
        } catch {
          // The message above stays; the next action will show the real state.
        }
        return;
      }
      handleFailure(e, "dialog");
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    setBusy("discard");
    setDialogError(null);
    try {
      const result = await postDiscard(invoice.id, invoice.version);
      router.push(`/orders/${result.order_id}`);
    } catch (e) {
      handleFailure(e, "dialog");
      setBusy(null);
    }
  }

  const issueBlockedReason = !orderConfirmed
    ? "The order is no longer confirmed."
    : invoice.stale
      ? "Refresh the draft from the order first."
      : invoice.blockers.length > 0
        ? "Some billed lines have no verified selling price."
        : invoice.nothing_to_bill
          ? "Set a delivered quantity above 0 on at least one line."
          : dirty
            ? "Save the quantities first."
            : null;

  return (
    <div className="space-y-4" data-testid="invoice-editor">
      <Link href={`/orders/${invoice.order_id}`} className="inline-flex min-h-11 items-center gap-1 text-primary" data-testid="back-to-order">
        <ChevronLeft size={20} aria-hidden="true" /> Order {formatOrderNumber(invoice.order_number)}
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold" data-testid="invoice-heading">
            Draft invoice
          </h1>
          <p className="text-muted" dir="auto" data-testid="invoice-store">
            {invoice.store.name}
          </p>
          <p className="text-sm text-muted">No invoice number yet: it is given when you issue the invoice.</p>
        </div>
        <span data-testid="invoice-status">
          <Badge>Draft</Badge>
        </span>
      </div>

      {!orderConfirmed ? (
        <div data-testid="order-not-confirmed">
          <Banner kind="error">
            <p className="font-medium">The order is no longer confirmed ({invoice.order_status}).</p>
            <p>This draft cannot be issued. You can discard it.</p>
          </Banner>
        </div>
      ) : null}
      {orderConfirmed && invoice.stale ? <StaleNotice onRefresh={() => void refresh()} busy={busy === "refresh"} hasUnsaved={dirty} /> : null}
      {orderConfirmed && !invoice.stale ? <InvoiceBlockers blockers={invoice.blockers} /> : null}
      {orderConfirmed && !invoice.stale && invoice.nothing_to_bill ? (
        <div data-testid="nothing-to-bill">
          <Banner kind="warning">Nothing is billed. Set a delivered quantity above 0 on at least one line.</Banner>
        </div>
      ) : null}
      {conflict ? (
        <div data-testid="version-conflict">
          <Banner kind="warning">
            <p className="font-medium">This invoice was changed elsewhere.</p>
            <div className="mt-1">
              <Button variant="secondary" onClick={() => onInvoiceChange(conflict)} data-testid="load-latest">
                Load the latest version
              </Button>
            </div>
          </Banner>
        </div>
      ) : null}
      {error ? (
        <div data-testid="invoice-error">
          <Banner kind="error">{error}</Banner>
        </div>
      ) : null}

      <ul className="space-y-3" data-testid="invoice-lines">
        {invoice.lines.map((line) => (
          <InvoiceLineRow
            key={line.id}
            line={line}
            value={values[line.id] ?? ""}
            onChange={(next) => setValues((prev) => ({ ...prev, [line.id]: next }))}
            error={parseDelivered(values[line.id] ?? "") === null ? "Enter a whole number from 0 to 100,000." : undefined}
            disabled={busy !== null}
          />
        ))}
      </ul>

      <div className="space-y-1 rounded-xl border border-border bg-surface px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium">Grand total</span>
          <span className="text-xl font-semibold" data-testid="invoice-grand-total">
            {formatInvoiceMoney(invoice.grand_total)}
          </span>
        </div>
        {dirty ? <p className="text-sm text-muted" data-testid="totals-after-save">Totals update after you save the quantities.</p> : null}
        {invoice.blockers.length > 0 ? <p className="text-sm text-muted">The total covers only the lines that have a selling price.</p> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} loading={busy === "save"} disabled={!dirty || invalid || busy !== null} data-testid="save-quantities">
          <Save size={18} aria-hidden="true" />
          Save quantities
        </Button>
        <Button
          onClick={() => {
            setDialogError(null);
            setDialog("issue");
          }}
          disabled={issueBlockedReason !== null || busy !== null}
          data-testid="issue-invoice"
        >
          Issue invoice
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setDialogError(null);
            setDialog("discard");
          }}
          disabled={busy !== null}
          data-testid="discard-invoice"
        >
          <Trash2 size={18} aria-hidden="true" />
          Discard draft
        </Button>
        <ButtonLink href={invoicePrintUrl(invoice.id, "a4")} variant="ghost" testId="print-preview">
          <Printer size={18} aria-hidden="true" />
          Print preview (saved quantities)
        </ButtonLink>
      </div>
      {issueBlockedReason ? (
        <p className="text-sm text-muted" data-testid="issue-blocked-reason">
          {issueBlockedReason}
        </p>
      ) : null}

      {invoice.events ? <InvoiceHistory events={invoice.events} /> : null}

      <IssueInvoiceDialog
        open={dialog === "issue"}
        onClose={() => setDialog(null)}
        onConfirm={() => void issue()}
        busy={busy === "issue"}
        error={dialogError}
        billedLines={billedLines}
        grandTotal={invoice.grand_total}
        storeName={invoice.store.name}
        payment={payment}
        onPaymentChange={(text) => {
          setPayment(text);
          setPaymentError(null);
        }}
        paymentError={paymentError}
      />
      <DiscardDraftDialog open={dialog === "discard"} onClose={() => setDialog(null)} onConfirm={() => void discard()} busy={busy === "discard"} error={dialogError} />
    </div>
  );
}
