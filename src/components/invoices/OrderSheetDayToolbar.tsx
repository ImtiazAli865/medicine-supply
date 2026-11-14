"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StoreFilter } from "@/components/market/StoreFilter";
import { PrintButton } from "@/components/market/PrintButton";
import type { MarketStore } from "@/lib/market/types";

/**
 * The toolbar of the order sheet page for a day (option B): the date, the stores to include, and Print. It is hidden
 * when printing. The choices live in the address, so a reload shows the same sheet.
 */
export function OrderSheetDayToolbar({ date, stores, selected, canPrint }: { date: string; stores: MarketStore[]; selected: string[]; canPrint: boolean }) {
  const router = useRouter();
  const go = (next: { date?: string; stores?: string[] }) => {
    const d = next.date ?? date;
    const s = next.stores ?? selected;
    const search = new URLSearchParams({ date: d });
    if (s.length > 0) search.set("stores", s.join(","));
    router.replace(`/orders/print?${search.toString()}`, { scroll: false });
  };
  return (
    <div className="space-y-3 print:hidden" data-testid="sheet-toolbar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/orders" className="inline-flex min-h-11 items-center gap-1 text-primary">
          <ChevronLeft size={20} aria-hidden="true" /> Orders
        </Link>
        {canPrint ? <PrintButton /> : null}
      </div>
      <div>
        <label htmlFor="sheet-date" className="mb-1 block text-sm font-medium">
          Orders confirmed on
        </label>
        <input
          id="sheet-date"
          type="date"
          value={date}
          onChange={(e) => (e.target.value ? go({ date: e.target.value, stores: [] }) : undefined)}
          className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base sm:w-auto"
          data-testid="sheet-date"
        />
      </div>
      <StoreFilter stores={stores} selected={selected} onChange={(ids) => go({ stores: ids })} />
    </div>
  );
}
