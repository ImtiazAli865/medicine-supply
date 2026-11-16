"use client";

import { BookOpen, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AccountListItem } from "@/components/accounts/AccountListItem";
import { Button, ButtonLink } from "@/components/ui/Button";
import { LoadingBlock } from "@/components/ui/Spinner";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { accountsApiUrl, accountsScreenUrl, getAccountsPage } from "@/lib/accounts/client";
import type { AccountRow } from "@/lib/accounts/types";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { usePagedList } from "@/lib/hooks/usePagedList";

const PAGE = 20;

const chip = (active: boolean) =>
  `inline-flex min-h-11 items-center rounded-lg px-4 text-base font-medium ${active ? "bg-primary text-white" : "border border-border bg-surface text-foreground"}`;

/**
 * The Store accounts list: every store with its balance (stores without entries show 0), the stores that owe first.
 * The search and the "only stores that owe" filter live in the address, so a reload or a shared link shows the same
 * list. Loading, error with Retry and an empty state that names the next action.
 */
export function AccountsScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const q = search.get("q") ?? "";
  const onlyOwing = search.get("owing") === "1";
  const params = useMemo(() => ({ q, onlyOwing }), [q, onlyOwing]);

  const [qText, setQText] = useState(q);
  const debounced = useDebouncedValue(qText, 300);
  useEffect(() => {
    if (debounced.trim() !== q.trim()) router.replace(accountsScreenUrl(debounced, onlyOwing), { scroll: false });
  }, [debounced, onlyOwing, q, router]);

  const urlFor = useCallback((offset: number) => accountsApiUrl(params, { limit: PAGE, offset }), [params]);
  const list = usePagedList<AccountRow>(urlFor, getAccountsPage);
  const current = list.current;
  const filtering = q.trim() !== "" || onlyOwing;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Store accounts</h1>

      <div className="relative">
        <Search size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          type="search"
          aria-label="Search stores"
          placeholder="Store name"
          value={qText}
          onChange={(e) => setQText(e.target.value)}
          dir="auto"
          className="min-h-11 w-full rounded-lg border border-border bg-surface py-2 pl-10 pr-3 text-base"
        />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter stores">
        <button type="button" aria-pressed={!onlyOwing} data-testid="filter-all" className={chip(!onlyOwing)} onClick={() => router.replace(accountsScreenUrl(qText, false), { scroll: false })}>
          All stores
        </button>
        <button type="button" aria-pressed={onlyOwing} data-testid="filter-owing" className={chip(onlyOwing)} onClick={() => router.replace(accountsScreenUrl(qText, true), { scroll: false })}>
          Stores that owe
        </button>
      </div>

      {!current ? (
        <LoadingBlock label="Loading store accounts…" />
      ) : current.error && current.items.length === 0 ? (
        <ErrorState message={current.error} onRetry={list.retry} />
      ) : current.items.length === 0 ? (
        filtering ? (
          <EmptyState
            icon={BookOpen}
            title="No stores match"
            description="Try a different name, or show all stores."
            action={
              <Button variant="secondary" onClick={() => router.replace(accountsScreenUrl("", false), { scroll: false })}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={BookOpen}
            title="No stores yet"
            description="Add a store first. Its account (khata) starts at 0 and fills as you issue invoices and record payments."
            action={<ButtonLink href="/stores/new">Add a store</ButtonLink>}
          />
        )
      ) : (
        <>
          <ul className="space-y-2" data-testid="account-list">
            {current.items.map((row) => (
              <AccountListItem key={row.store_id} row={row} />
            ))}
          </ul>
          {current.error ? (
            <p role="alert" className="text-sm text-danger">
              {current.error}
            </p>
          ) : null}
          {current.items.length < current.total ? (
            <Button variant="secondary" loading={list.loadingMore} onClick={() => void list.loadMore()} data-testid="accounts-more">
              Show more
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
