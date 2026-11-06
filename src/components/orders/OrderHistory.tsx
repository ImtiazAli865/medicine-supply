"use client";

import { ClipboardList, Plus, Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { OrderListItem } from "@/components/orders/OrderListItem";
import { StoreSelector } from "@/components/orders/StoreSelector";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { LoadingBlock } from "@/components/ui/Spinner";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import { useApiResource } from "@/lib/hooks/useApiResource";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { todayInPakistan } from "@/lib/orders/dates";
import type { OrderPage, OrderSummary } from "@/lib/orders/types";
import type { Store } from "@/lib/stores/types";

const STATUSES = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "confirmed", label: "Confirmed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

const FILTER_KEYS = ["store", "status", "from", "to", "q"] as const;
type Filters = Record<(typeof FILTER_KEYS)[number], string>;

const chip = (active: boolean) =>
  `inline-flex min-h-11 items-center rounded-lg px-4 text-base font-medium ${active ? "bg-primary text-white" : "border border-border bg-surface text-foreground"}`;
const inputClass = "min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base";

interface Loaded {
  key: string;
  items: OrderSummary[];
  next: string | null;
  error: string | null;
}

/** Order history, newest first. The filters live in the address (?store= &status= &from= &to= &q=). */
export function OrderHistory() {
  const router = useRouter();
  const params = useSearchParams();
  const filters = useMemo<Filters>(
    () => ({ store: params.get("store") ?? "", status: params.get("status") ?? "", from: params.get("from") ?? "", to: params.get("to") ?? "", q: params.get("q") ?? "" }),
    [params],
  );

  const setFilters = useCallback(
    (patch: Partial<Filters>) => {
      const next = new URLSearchParams();
      for (const key of FILTER_KEYS) {
        const value = key in patch ? (patch[key] ?? "") : filters[key];
        if (value) next.set(key, value);
      }
      const query = next.toString();
      router.replace(query ? `/orders?${query}` : "/orders", { scroll: false });
    },
    [filters, router],
  );

  // The search box updates the address after a short pause.
  const [qText, setQText] = useState(filters.q);
  const debouncedQ = useDebouncedValue(qText, 300);
  useEffect(() => {
    if (debouncedQ !== filters.q) setFilters({ q: debouncedQ });
  }, [debouncedQ, filters.q, setFilters]);

  const [storeOpen, setStoreOpen] = useState(false);
  const storeInfo = useApiResource<Store>(filters.store ? `/api/stores/${filters.store}` : null);

  const [attempt, setAttempt] = useState(0);
  const queryString = useMemo(() => {
    const p = new URLSearchParams({ limit: "30" });
    if (filters.store) p.set("store_id", filters.store);
    if (filters.status) p.set("status", filters.status);
    if (filters.from) p.set("from", filters.from);
    if (filters.to) p.set("to", filters.to);
    if (filters.q.trim()) p.set("q", filters.q.trim());
    return p.toString();
  }, [filters]);
  const key = `${queryString}#${attempt}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchJson<OrderPage>(`/api/orders?${queryString}`, { signal: controller.signal })
      .then(({ data }) => setLoaded({ key, items: data.items, next: data.next_cursor, error: null }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setLoaded({ key, items: [], next: null, error: e instanceof ClientApiError ? e.message : "Something went wrong. Please try again." });
      });
    return () => controller.abort();
  }, [queryString, key]);

  async function loadMore() {
    if (!loaded?.next || loadingMore) return;
    setLoadingMore(true);
    try {
      const { data } = await fetchJson<OrderPage>(`/api/orders?${queryString}&cursor=${loaded.next}`);
      setLoaded((prev) => (prev ? { ...prev, items: [...prev.items, ...data.items], next: data.next_cursor, error: null } : prev));
    } catch (e) {
      setLoaded((prev) => (prev ? { ...prev, error: e instanceof ClientApiError ? e.message : "Something went wrong. Please try again." } : prev));
    } finally {
      setLoadingMore(false);
    }
  }

  const current = loaded?.key === key ? loaded : null;
  const filtering = Boolean(filters.store || filters.status || filters.from || filters.to || filters.q.trim());
  const today = todayInPakistan();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Orders</h1>
        <ButtonLink href="/orders/new" data-testid="new-order">
          <Plus size={20} aria-hidden="true" />
          New order
        </ButtonLink>
      </div>

      <div className="relative">
        <Search size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          type="search"
          aria-label="Search orders"
          placeholder="Order number or store name"
          value={qText}
          onChange={(e) => setQText(e.target.value)}
          dir="auto"
          className="min-h-11 w-full rounded-lg border border-border bg-surface py-2 pl-10 pr-3 text-base"
        />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {STATUSES.map((s) => (
          <button key={s.value} type="button" aria-pressed={filters.status === s.value} className={chip(filters.status === s.value)} onClick={() => setFilters({ status: s.value })}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {filters.store ? (
          <button type="button" className={chip(true)} onClick={() => setFilters({ store: "" })} aria-label="Clear store filter" data-testid="store-chip">
            Store: {storeInfo.data?.name ?? "…"} <X size={18} className="ml-2" aria-hidden="true" />
          </button>
        ) : (
          <Button variant="secondary" onClick={() => setStoreOpen(true)} data-testid="filter-store">
            All stores
          </Button>
        )}
        <button type="button" aria-pressed={filters.from === today && filters.to === today} className={chip(filters.from === today && filters.to === today)} onClick={() => setFilters(filters.from === today && filters.to === today ? { from: "", to: "" } : { from: today, to: today })}>
          Today
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="orders-from" className="mb-1 block text-sm font-medium">
            From
          </label>
          <input id="orders-from" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilters({ from: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label htmlFor="orders-to" className="mb-1 block text-sm font-medium">
            To
          </label>
          <input id="orders-to" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilters({ to: e.target.value })} className={inputClass} />
        </div>
      </div>

      {!current ? (
        <LoadingBlock label="Loading orders…" />
      ) : current.error && current.items.length === 0 ? (
        <ErrorState message={current.error} onRetry={() => setAttempt((a) => a + 1)} />
      ) : current.items.length === 0 ? (
        filtering ? (
          <EmptyState
            icon={Search}
            title="No orders match"
            description="Try different filters."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setQText("");
                  router.replace("/orders", { scroll: false });
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState icon={ClipboardList} title="No orders yet" description="Orders you take appear here, store by store." action={<ButtonLink href="/orders/new">Take your first order</ButtonLink>} />
        )
      ) : (
        <>
          <ul className="space-y-3" data-testid="order-list">
            {current.items.map((order) => (
              <OrderListItem key={order.id} order={order} />
            ))}
          </ul>
          {current.error ? <p role="alert" className="text-danger">{current.error}</p> : null}
          {current.next ? (
            <Button variant="secondary" className="w-full" onClick={loadMore} loading={loadingMore}>
              Show more
            </Button>
          ) : null}
        </>
      )}

      <Dialog open={storeOpen} title="Filter by store" onClose={() => setStoreOpen(false)}>
        <StoreSelector
          onSelect={(store) => {
            setStoreOpen(false);
            setFilters({ store: store.id });
          }}
        />
        <Button variant="ghost" className="w-full" onClick={() => setStoreOpen(false)}>
          Close
        </Button>
      </Dialog>
    </div>
  );
}
