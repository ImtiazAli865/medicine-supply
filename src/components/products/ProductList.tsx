"use client";

import { FileUp, Pill, Plus, Search, Tag } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { StatusFilterControl } from "@/components/ui/StatusFilter";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { LoadingBlock } from "@/components/ui/Spinner";
import { useSearchList, type StatusFilter } from "@/lib/hooks/useSearchList";
import { formatPKR } from "@/lib/money";
import type { Product } from "@/lib/products/types";

export function ProductList() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const list = useSearchList<Product>("/api/products", query, status);

  const filtering = list.activeQuery !== "" || status !== "active";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Products</h1>
        <ButtonLink href="/products/new">
          <Plus size={20} aria-hidden="true" />
          Add medicine
        </ButtonLink>
      </div>
      <Link href="/products/import" className="inline-flex min-h-11 items-center gap-2 font-medium text-primary underline">
        <FileUp size={20} aria-hidden="true" />
        Import from file
      </Link>
      <Link href="/pending?tab=prices" data-testid="pending-prices-link" className="ml-4 inline-flex min-h-11 items-center gap-2 font-medium text-primary underline">
        <Tag size={20} aria-hidden="true" />
        Pending prices
      </Link>

      <div className="relative">
        <Search size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          type="search"
          aria-label="Search medicines"
          placeholder="Search name, brand, generic, strength, SKU…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          dir="auto"
          className="min-h-11 w-full rounded-lg border border-border bg-surface py-2 pl-10 pr-3 text-base"
        />
      </div>

      <StatusFilterControl value={status} onChange={setStatus} />

      {list.error && list.items.length === 0 ? (
        <ErrorState message={list.error} onRetry={list.retry} />
      ) : list.loading && list.items.length === 0 ? (
        <LoadingBlock label="Loading medicines…" />
      ) : list.items.length === 0 ? (
        filtering ? (
          <EmptyState
            icon={Search}
            title="No medicines found"
            description="Try different words, or add this medicine."
            action={<ButtonLink href="/products/new" variant="secondary">Add a medicine</ButtonLink>}
          />
        ) : (
          <EmptyState
            icon={Pill}
            title="Add your first medicine"
            description="Only the name and unit are needed. Prices can be added later. Deactivated medicines are under Inactive. Or import a whole list from a file."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink href="/products/new">Add your first medicine</ButtonLink>
                <ButtonLink href="/products/import" variant="secondary">Import from file</ButtonLink>
              </div>
            }
          />
        )
      ) : (
        <>
          {list.error ? <ErrorState message={list.error} onRetry={list.retry} /> : null}
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface" aria-busy={list.loading}>
            {list.items.map((p) => (
              <li key={p.id}>
                <Link href={`/products/${p.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block truncate font-medium" dir="auto">
                      {p.name}
                    </span>
                    <span className="block truncate text-sm text-muted" dir="auto">
                      {[p.strength, p.dosage_form, p.pack_size, p.unit].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {p.selling_price ? <span className="font-medium">{formatPKR(p.selling_price)}</span> : <Badge tone="warning">No selling price</Badge>}
                    {!p.is_active ? <Badge>Inactive</Badge> : null}
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
