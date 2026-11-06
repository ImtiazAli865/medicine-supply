"use client";

import { Plus, Search, Store as StoreIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { StatusFilterControl } from "@/components/ui/StatusFilter";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { LoadingBlock } from "@/components/ui/Spinner";
import { useSearchList, type StatusFilter } from "@/lib/hooks/useSearchList";
import type { Store } from "@/lib/stores/types";

export function StoreList() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const list = useSearchList<Store>("/api/stores", query, status);

  const filtering = list.activeQuery !== "" || status !== "active";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Stores</h1>
        <ButtonLink href="/stores/new">
          <Plus size={20} aria-hidden="true" />
          Add store
        </ButtonLink>
      </div>

      <div className="relative">
        <Search size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          type="search"
          aria-label="Search stores"
          placeholder="Search by name, contact or phone"
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
        <LoadingBlock label="Loading stores…" />
      ) : list.items.length === 0 ? (
        filtering ? (
          <EmptyState
            icon={Search}
            title="No stores found"
            description="Try different words, or add this store."
            action={<ButtonLink href="/stores/new" variant="secondary">Add a store</ButtonLink>}
          />
        ) : (
          <EmptyState
            icon={StoreIcon}
            title="Add your first store"
            description="Stores are the pharmacies you supply. Only the name is needed. Deactivated stores are under Inactive."
            action={<ButtonLink href="/stores/new">Add your first store</ButtonLink>}
          />
        )
      ) : (
        <>
          {list.error ? <ErrorState message={list.error} onRetry={list.retry} /> : null}
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface" aria-busy={list.loading}>
            {list.items.map((store) => (
              <li key={store.id}>
                <Link href={`/stores/${store.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block truncate font-medium" dir="auto">
                      {store.name}
                    </span>
                    {store.contact_person || store.phone ? (
                      <span className="block truncate text-sm text-muted" dir="auto">
                        {[store.contact_person, store.phone].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                  </span>
                  {!store.is_active ? <Badge>Inactive</Badge> : null}
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
