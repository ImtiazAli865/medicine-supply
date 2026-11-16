import { AccountSummaryBlock } from "@/components/invoices/AccountSummaryBlock";
import { formatInvoiceMoney } from "@/lib/invoices/status";
import type { Invoice, InvoiceLine } from "@/lib/invoices/types";
import type { PrintLayout } from "@/lib/invoices/status";

function join(parts: Array<string | null | undefined>, separator = " · "): string {
  return parts.filter((part): part is string => Boolean(part)).join(separator);
}

function lineDetails(line: InvoiceLine): string {
  return join([line.strength, line.dosage_form, line.pack_size]);
}

/** The mark above the invoice: a draft is only a preview, a cancelled invoice keeps its number but is marked. */
function Mark({ invoice }: { invoice: Invoice }) {
  if (invoice.status === "draft") {
    return (
      <p className="border-2 border-dashed border-slate-600 py-1 text-center text-base font-bold uppercase tracking-wide" data-testid="print-mark">
        DRAFT, not an invoice
      </p>
    );
  }
  if (invoice.status === "cancelled") {
    return (
      <p className="border-2 border-slate-900 py-1 text-center text-base font-bold uppercase tracking-wide" data-testid="print-mark">
        CANCELLED
      </p>
    );
  }
  return null;
}

/**
 * The customer-facing invoice. It shows only: the business name and the details saved in Settings, the invoice number
 * and date, the store, and for each billed line the product name, quantity, selling price and line total, then the
 * grand total. No purchase price, MRP, cost, margin or profit exists in the invoice data, so none can be printed.
 * A line with a delivered quantity of 0 is not billed and is not printed. Missing business details are left out.
 */
export function InvoicePrintView({
  invoice,
  layout,
  thermalWidthMm,
  showSummary = false,
}: {
  invoice: Invoice;
  layout: PrintLayout;
  thermalWidthMm: number;
  /** Show the Account Summary block (only for an issued invoice that has a saved snapshot). */
  showSummary?: boolean;
}) {
  const billed = invoice.lines.filter((l) => l.billed);
  const summary = showSummary && invoice.status === "issued" ? invoice.account_summary : null;
  const heading = invoice.number_label ?? "Draft preview";
  const dateText = invoice.invoice_date ?? "Draft: no invoice date yet";

  if (layout === "thermal") {
    return (
      <article
        data-testid="invoice-print"
        data-layout="thermal"
        style={{ width: `${Math.max(thermalWidthMm - 6, 30)}mm` }}
        className="mx-auto space-y-2 text-[13px] leading-snug text-black"
      >
        <header className="space-y-0.5 text-center">
          <h1 className="break-words text-base font-bold" dir="auto" data-testid="print-business">
            {invoice.business.name}
          </h1>
          {invoice.business.phone ? <p dir="auto">{invoice.business.phone}</p> : null}
          {invoice.business.address ? <p dir="auto">{invoice.business.address}</p> : null}
        </header>
        <Mark invoice={invoice} />
        <div className="border-y border-dashed border-black py-1">
          <p className="font-bold" data-testid="print-number">
            {heading}
          </p>
          <p data-testid="print-date">{dateText}</p>
          <p dir="auto" data-testid="print-store">
            To: {invoice.store.name}
          </p>
          {join([invoice.store.phone], "") ? <p dir="auto">{invoice.store.phone}</p> : null}
        </div>
        <ul className="space-y-1.5" data-testid="print-lines">
          {billed.map((line) => (
            <li key={line.id} data-testid="print-line" className="break-inside-avoid">
              <p className="break-words font-semibold" dir="auto">
                {line.name}
              </p>
              {lineDetails(line) ? <p className="text-[11px]" dir="auto">{lineDetails(line)}</p> : null}
              <p className="flex justify-between gap-2">
                <span>
                  {line.delivered_quantity.toLocaleString("en-US")} {line.unit} × {formatInvoiceMoney(line.selling_price)}
                </span>
                <span className="font-semibold" data-testid="print-line-total">
                  {formatInvoiceMoney(line.line_total)}
                </span>
              </p>
            </li>
          ))}
        </ul>
        <p className="flex items-baseline justify-between gap-2 break-inside-avoid border-t-2 border-black pt-1 text-base font-bold">
          <span>TOTAL</span>
          <span data-testid="print-grand-total">{formatInvoiceMoney(invoice.grand_total)}</span>
        </p>
        {summary ? <AccountSummaryBlock summary={summary} layout="thermal" /> : null}
      </article>
    );
  }

  return (
    <article data-testid="invoice-print" data-layout="a4" className="mx-auto max-w-3xl space-y-4 text-black print:max-w-none">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-400 pb-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold" dir="auto" data-testid="print-business">
            {invoice.business.name}
          </h1>
          {invoice.business.phone ? <p dir="auto">{invoice.business.phone}</p> : null}
          {invoice.business.address ? <p dir="auto">{invoice.business.address}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold uppercase tracking-wide">Invoice</p>
          <p className="text-xl font-bold" data-testid="print-number">
            {heading}
          </p>
          <p data-testid="print-date">{dateText}</p>
        </div>
      </header>

      <Mark invoice={invoice} />

      <section aria-label="Billed to">
        <p className="text-sm font-semibold uppercase tracking-wide">Billed to</p>
        <p className="text-lg font-semibold" dir="auto" data-testid="print-store">
          {invoice.store.name}
        </p>
        {join([invoice.store.contact_person, invoice.store.phone]) ? <p dir="auto">{join([invoice.store.contact_person, invoice.store.phone])}</p> : null}
        {invoice.store.address ? <p dir="auto">{invoice.store.address}</p> : null}
      </section>

      <table className="w-full border-collapse text-sm" data-testid="print-lines">
        <thead>
          <tr className="border-y border-slate-500 text-left">
            <th className="py-1 pr-2">#</th>
            <th className="py-1 pr-2">Product</th>
            <th className="py-1 pr-2 text-right">Quantity</th>
            <th className="py-1 pr-2 text-right">Price</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {billed.map((line, index) => (
            <tr key={line.id} data-testid="print-line" className="break-inside-avoid border-b border-slate-300 align-top">
              <td className="py-1 pr-2">{index + 1}</td>
              <td className="py-1 pr-2">
                <span className="break-words font-medium" dir="auto">
                  {line.name}
                </span>
                {lineDetails(line) ? <span className="block text-xs" dir="auto">{lineDetails(line)}</span> : null}
              </td>
              <td className="whitespace-nowrap py-1 pr-2 text-right">
                {line.delivered_quantity.toLocaleString("en-US")} {line.unit}
              </td>
              <td className="whitespace-nowrap py-1 pr-2 text-right">{formatInvoiceMoney(line.selling_price)}</td>
              <td className="whitespace-nowrap py-1 text-right font-medium" data-testid="print-line-total">
                {formatInvoiceMoney(line.line_total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="flex items-baseline justify-end gap-4 break-inside-avoid border-t-2 border-slate-700 pt-2 text-xl font-bold">
        <span>Grand total</span>
        <span data-testid="print-grand-total">{formatInvoiceMoney(invoice.grand_total)}</span>
      </p>
      {summary ? <AccountSummaryBlock summary={summary} layout="a4" /> : null}
    </article>
  );
}
