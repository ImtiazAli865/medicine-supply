import type { MarketList, MarketRow } from "@/lib/market/types";
import { formatDay, describeRow } from "@/lib/market/status";

/**
 * The market list as one compact A4 page to carry to the wholesale market. Each medicine shows its total and its
 * stores; the Bought and Left columns are filled from recorded purchases and are blank otherwise, so they can be
 * written by hand. The group "Not yet registered" is included, every entry marked "unregistered". No price, cost,
 * MRP, margin or profit is ever printed here. Thermal (80 mm) printing comes with invoices (Module 006).
 */
export function MarketPrintView({ list, selectedStoreIds }: { list: MarketList; selectedStoreIds: string[] }) {
  const selected = selectedStoreIds.length > 0 ? list.stores.filter((s) => selectedStoreIds.includes(s.id)) : [];
  const storesIncluded = selected.length > 0 ? selected.map((s) => s.name).join(", ") : "All stores";

  return (
    <article className="space-y-4 text-foreground" data-testid="market-print">
      <header className="space-y-1 border-b border-slate-400 pb-2">
        <h1 className="break-words text-xl font-bold" data-testid="print-business">
          {list.business_name ?? "Market list"}
        </h1>
        <p className="font-semibold" data-testid="print-title">
          Market list · {formatDay(list.date)}
        </p>
        <p className="text-sm" data-testid="print-stores">
          Stores included: {storesIncluded}
        </p>
      </header>

      {list.rows.length === 0 && list.typed_rows.length === 0 ? <p>No confirmed orders for this date.</p> : null}

      {list.rows.length > 0 ? <PrintTable rows={list.rows} testId="print-rows" /> : null}

      {list.typed_rows.length > 0 ? (
        <section className="space-y-2 break-inside-avoid-page" data-testid="print-unregistered">
          <h2 className="text-lg font-bold">Not yet registered</h2>
          <PrintTable rows={list.typed_rows} testId="print-typed-rows" />
        </section>
      ) : null}
    </article>
  );
}

function PrintTable({ rows, testId }: { rows: MarketRow[]; testId: string }) {
  return (
    <table className="w-full table-fixed border-collapse text-sm" data-testid={testId}>
      <thead>
        <tr className="bg-slate-100 text-left print:bg-transparent">
          <th className="w-1/2 border border-slate-400 p-1.5">Medicine</th>
          <th className="w-1/6 border border-slate-400 p-1.5">Total</th>
          <th className="w-1/6 border border-slate-400 p-1.5">Bought</th>
          <th className="w-1/6 border border-slate-400 p-1.5">Left</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const registered = row.product_id !== null;
          const detail = registered ? describeRow(row) : "";
          const bought = registered && row.purchased > 0;
          return (
            <tr key={row.key} className="break-inside-avoid align-top" data-testid="print-row">
              <td className="border border-slate-400 p-1.5">
                <p className="break-words font-semibold">
                  {registered ? row.name : row.typed_name}
                  {registered ? null : <span className="ml-1 font-normal">(unregistered)</span>}
                </p>
                {detail ? <p className="text-xs">{detail}</p> : null}
                <ul className="mt-1 space-y-0.5 text-xs">
                  {row.stores.map((s) => (
                    <li key={s.store_id} className="flex justify-between gap-2">
                      <span className="min-w-0 break-words">{s.store_name}</span>
                      <span className="shrink-0">{s.quantity}</span>
                    </li>
                  ))}
                </ul>
              </td>
              <td className="border border-slate-400 p-1.5 font-semibold">
                {row.total_requested} {row.unit}
              </td>
              <td className="border border-slate-400 p-1.5">{bought ? row.purchased : ""}</td>
              <td className="border border-slate-400 p-1.5">{bought ? row.remaining : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
