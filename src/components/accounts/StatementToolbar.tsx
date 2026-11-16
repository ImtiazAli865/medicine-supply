"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PrintButton } from "@/components/market/PrintButton";
import { accountUrl, statementUrl } from "@/lib/accounts/client";
import { todayInPakistan } from "@/lib/orders/dates";

/**
 * The toolbar of the Store Statement page: the date range and Print. It is hidden when printing. The range lives in
 * the address, so a reload or a shared link shows the same statement.
 */
export function StatementToolbar({ storeId, from, to, canPrint }: { storeId: string; from: string; to: string; canPrint: boolean }) {
  const router = useRouter();
  const today = todayInPakistan();
  const go = (next: { from?: string; to?: string }) => {
    router.replace(statementUrl(storeId, next.from ?? from, next.to ?? to), { scroll: false });
  };
  return (
    <div className="space-y-3 print:hidden" data-testid="statement-toolbar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={accountUrl(storeId)} className="inline-flex min-h-11 items-center gap-1 text-primary">
          <ChevronLeft size={20} aria-hidden="true" /> Store account
        </Link>
        {canPrint ? <PrintButton /> : null}
      </div>
      <div className="flex flex-wrap gap-3">
        <div>
          <label htmlFor="statement-from" className="mb-1 block text-sm font-medium">
            From
          </label>
          <input
            id="statement-from"
            type="date"
            min="2000-01-01"
            max={today}
            value={from}
            onChange={(e) => (e.target.value ? go({ from: e.target.value }) : undefined)}
            className="min-h-11 rounded-lg border border-border bg-surface px-3 py-2 text-base"
            data-testid="statement-from"
          />
        </div>
        <div>
          <label htmlFor="statement-to" className="mb-1 block text-sm font-medium">
            To
          </label>
          <input
            id="statement-to"
            type="date"
            min="2000-01-01"
            max={today}
            value={to}
            onChange={(e) => (e.target.value ? go({ to: e.target.value }) : undefined)}
            className="min-h-11 rounded-lg border border-border bg-surface px-3 py-2 text-base"
            data-testid="statement-to"
          />
        </div>
      </div>
    </div>
  );
}
