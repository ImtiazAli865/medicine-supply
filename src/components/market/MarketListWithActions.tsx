"use client";

import { ClipboardList, Download, History, PackagePlus, Printer } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { marketExportUrl, marketPrintUrl, type ListParams } from "@/lib/market/client";
import { formatDay } from "@/lib/market/status";
import type { MarketRow, PurchaseEntry } from "@/lib/market/types";
import { MarketListScreen } from "./MarketListScreen";
import { PurchaseHistoryDialog } from "./PurchaseHistoryDialog";
import { RecordPurchaseDialog } from "./RecordPurchaseDialog";
import { UpdateCostOffer } from "./UpdateCostOffer";

type Active =
  | { kind: "record"; row: MarketRow; date: string; reload: () => void }
  | { kind: "history"; row: MarketRow; date: string; reload: () => void }
  | { kind: "offer"; productId: string; name: string; cost: string };

/** Wires the screen's action slots (purchase buttons, register link, print and export) to the real components. */
export function MarketListWithActions({ initial }: { initial: ListParams }) {
  const toast = useToast();
  const [active, setActive] = useState<Active | null>(null);

  function saved(entry: PurchaseEntry, purchaseDate: string, listDate: string, row: MarketRow, reload: () => void) {
    reload();
    toast.show(
      purchaseDate === listDate
        ? `Saved: ${entry.quantity} ${entry.unit} of ${row.name}.`
        : `Saved: ${entry.quantity} ${entry.unit} of ${row.name}, counted for ${formatDay(purchaseDate)}.`,
      "success",
    );
    // Only a purchase that has an actual cost can lead to the question about the purchase price.
    setActive(entry.unit_cost && row.product_id ? { kind: "offer", productId: row.product_id, name: row.name ?? "", cost: entry.unit_cost } : null);
  }

  return (
    <>
      <MarketListScreen
        initial={initial}
        toolbar={(params, disabled) =>
          disabled ? null : (
            <>
              <Link href={marketPrintUrl(params)} className={buttonClass("secondary")} data-testid="market-print">
                <Printer size={20} aria-hidden="true" />
                Print
              </Link>
              <a href={marketExportUrl(params)} download className={buttonClass("secondary")} data-testid="market-export">
                <Download size={20} aria-hidden="true" />
                Export CSV
              </a>
            </>
          )
        }
        rowActions={(row, list) => (
          <>
            <Button onClick={() => setActive({ kind: "record", row, date: list.date, reload: list.reload })} data-testid="record-purchase">
              <PackagePlus size={20} aria-hidden="true" />
              Record purchase
            </Button>
            <Button variant="secondary" onClick={() => setActive({ kind: "history", row, date: list.date, reload: list.reload })} data-testid="purchase-history-open">
              <History size={20} aria-hidden="true" />
              Purchase history
            </Button>
          </>
        )}
        typedActions={(row) => (
          <Link
            href={`/pending?tab=register&q=${encodeURIComponent(row.typed_name ?? "")}`}
            data-testid="register-link"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-base font-medium text-primary hover:bg-primary-soft"
          >
            <ClipboardList size={20} aria-hidden="true" />
            Register this medicine
          </Link>
        )}
      />

      {active?.kind === "record" ? (
        <RecordPurchaseDialog
          open
          row={active.row}
          date={active.date}
          onClose={() => setActive(null)}
          onSaved={(entry, purchaseDate) => saved(entry, purchaseDate, active.date, active.row, active.reload)}
        />
      ) : null}
      {active?.kind === "history" ? (
        <PurchaseHistoryDialog open row={active.row} date={active.date} onClose={() => setActive(null)} onChanged={active.reload} />
      ) : null}
      {active?.kind === "offer" ? <UpdateCostOffer productId={active.productId} productName={active.name} cost={active.cost} onDone={() => setActive(null)} /> : null}
    </>
  );
}
