"use client";

import { Search, Tag } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { LoadingBlock } from "@/components/ui/Spinner";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { useSearchList } from "@/lib/hooks/useSearchList";
import { formatPKR } from "@/lib/money";
import type { PriceItem } from "@/lib/pending/types";

/**
 * Medicines that need a selling price: active ones without one, and priced ones that still have confirmed order
 * lines waiting for a price. The medicines with the most waiting lines come first.
 */
export function PendingPricesList() {
  const [query, setQuery] = useState("");
  const list = useSearchList<PriceItem>("/api/pending/prices", query, "active");
  const searching = list.activeQuery !== "";

  return (
    <div className="space-y-4" data-testid="pending-prices">
      <div className="relative">
        <Search size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          type="search"
          aria-label="Search medicines that need a price"
          placeholder="Search name, strength, form…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          dir="auto"
          className="min-h-11 w-full rounded-lg border border-border bg-surface py-2 pl-10 pr-3 text-base"
        />
      </div>

      {list.error && list.items.length === 0 ? (
        <ErrorState message={list.error} onRetry={list.retry} />
      ) : list.loading && list.items.length === 0 ? (
        <LoadingBlock label="Loading medicines…" />
      ) : list.items.length === 0 ? (
        searching ? (
          <EmptyState icon={Search} title="No medicines found" description="Try different words." />
        ) : (
          <EmptyState
            icon={Tag}
            title="Nothing needs a price"
            description="Every active medicine has a selling price and no confirmed order line is waiting for one. New medicines without a price will show up here."
            action={
              <ButtonLink href="/products/new" variant="secondary">
                Add a medicine
              </ButtonLink>
            }
          />
        )
      ) : (
        <>
          {list.error ? <ErrorState message={list.error} onRetry={list.retry} /> : null}
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface" aria-busy={list.loading}>
            {list.items.map((item) => (
              <li key={item.product_id}>
                <Link href={`/pending/prices/${item.product_id}`} data-testid="price-item" className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block truncate font-medium" dir="auto">
                      {item.name}
                    </span>
                    <span className="block truncate text-sm text-muted" dir="auto">
                      {[item.strength, item.dosage_form, item.pack_size, item.unit].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1 text-right">
                    {item.selling_price === null ? <Badge tone="warning">No selling price</Badge> : <span className="font-medium">{formatPKR(item.selling_price)}</span>}
                    <span className="text-sm text-muted" data-testid="price-item-waiting">
                      {item.lines_waiting === 0
                        ? "No lines waiting"
                        : `${item.lines_waiting} ${item.lines_waiting === 1 ? "line" : "lines"} in ${item.orders_waiting} ${item.orders_waiting === 1 ? "order" : "orders"}`}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {list.hasMore ? (
            <Button variant="secondary" onClick={list.loadMore} loading={list.loadingMore} className="w-full">
              Load more
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
