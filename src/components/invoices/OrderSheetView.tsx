import type { OrderSheet, OrderSheetLine } from "@/lib/invoices/types";
import { formatOrderNumber } from "@/lib/orders/number";

function join(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

function lineDetails(line: OrderSheetLine): string {
  return join([line.strength, line.dosage_form, line.pack_size, line.manufacturer]);
}

/**
 * An order sheet (print options A and B): the business header once, then one section per order and store, each with
 * its own complete product list. Only the product, quantity and unit are shown, never a price: an order sheet is not
 * an invoice. A typed medicine is shown as typed with an "unregistered" mark; nothing is invented for it. Items of
 * different stores are never merged: every section is its own list.
 */
export function OrderSheetView({ sheet, title }: { sheet: OrderSheet; title: string }) {
  return (
    <article className="mx-auto max-w-3xl space-y-5 text-black print:max-w-none" data-testid="order-sheet">
      <header className="space-y-0.5 border-b border-slate-400 pb-2">
        <h1 className="break-words text-xl font-bold" dir="auto" data-testid="sheet-business">
          {sheet.business.name}
        </h1>
        {sheet.business.phone ? <p dir="auto">{sheet.business.phone}</p> : null}
        {sheet.business.address ? <p dir="auto">{sheet.business.address}</p> : null}
        <p className="pt-1 font-semibold" data-testid="sheet-title">
          {title}
        </p>
      </header>

      {sheet.sections.map((section) => (
        <section key={section.order_id} data-testid="sheet-section" data-order-id={section.order_id} className="space-y-2 break-inside-avoid-page">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-300 pb-1">
            <h2 className="break-words text-lg font-bold" dir="auto" data-testid="sheet-store">
              {section.store.name}
            </h2>
            <p className="text-sm" data-testid="sheet-order">
              {formatOrderNumber(section.order_number)} · {section.order_date}
            </p>
          </div>
          {join([section.store.contact_person, section.store.phone]) ? <p className="text-sm" dir="auto">{join([section.store.contact_person, section.store.phone])}</p> : null}
          {section.store.address ? <p className="text-sm" dir="auto">{section.store.address}</p> : null}
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-slate-500 text-left">
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">Product</th>
                <th className="py-1 text-right">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {section.lines.map((line, index) => (
                <tr key={`${line.position}-${index}`} data-testid="sheet-line" className="break-inside-avoid border-b border-slate-300 align-top">
                  <td className="py-1 pr-2">{index + 1}</td>
                  <td className="py-1 pr-2">
                    <span className="break-words font-medium" dir="auto">
                      {line.name}
                    </span>
                    {line.unregistered ? <span className="ml-2 border border-slate-600 px-1 text-xs uppercase" data-testid="sheet-unregistered">unregistered</span> : null}
                    {lineDetails(line) ? <span className="block text-xs" dir="auto">{lineDetails(line)}</span> : null}
                  </td>
                  <td className="whitespace-nowrap py-1 text-right font-medium">
                    {line.quantity.toLocaleString("en-US")} {line.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </article>
  );
}
