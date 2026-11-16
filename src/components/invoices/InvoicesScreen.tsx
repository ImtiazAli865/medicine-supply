"use client";

import { FileText, Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { InvoiceListItem } from "@/components/invoices/InvoiceListItem";
import { ToInvoiceList } from "@/components/invoices/ToInvoiceList";
import { StoreSelector } from "@/components/orders/StoreSelector";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { LoadingBlock } from "@/components/ui/Spinner";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { ClientApiError } from "@/lib/api/client";
import { useApiResource } from "@/lib/hooks/useApiResource";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import {
  DEFAULT_LIST_PARAMS,
  getInvoicePage,
  getToInvoicePage,
  invoicesApiUrl,
  invoicesScreenUrl,
  toInvoiceApiUrl,
  type InvoiceListParams,
  type InvoiceTab,
} from "@/lib/invoices/client";
import type { InvoiceSummaryRow, ToInvoiceRow } from "@/lib/invoices/types";
import { todayInPakistan } from "@/lib/orders/dates";
import type { Store } from "@/lib/stores/types";

const PAGE = 20;

const STATUSES = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "issued", label: "Issued" },
  { value: "cancelled", label: "Cancelled" },
] as const;

const PAYMENTS = [
  { value: "all", label: "All payments" },
  { value: "unpaid", label: "Unpaid" },
  { value: "partially_paid", label: "Partly paid" },
  { value: "paid", label: "Paid" },
] as const;

const chip = (active: boolean) =>
  `inline-flex min-h-11 items-center rounded-lg px-4 text-base font-medium ${active ? "bg-primary text-white" : "border border-border bg-surface text-foreground"}`;
const inputClass = "min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base";

function messageOf(e: unknown): string {
  return e instanceof ClientApiError ? e.message : "Something went wrong. Please try again.";
}

interface Loaded<T> {
  key: string;
  items: T[];
  total: number;
  error: string | null;
}

/** Pages of a list that is read by offset. The page from the first request is replaced, later pages are appended. */
function usePagedList<T>(urlFor: (offset: number) => string, load: (url: string) => Promise<{ items: T[]; total: number }>, attempt: number) {
  const first = urlFor(0);
  const key = `${first}#${attempt}`;
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    load(first)
      .then((page) => {
        if (!cancelled) setLoaded({ key, items: page.items, total: page.total, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoaded({ key, items: [], total: 0, error: messageOf(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [first, key, load]);

  const current = loaded?.key === key ? loaded : null;

  async function loadMore() {
    if (!current || loadingMore || current.items.length >= current.total) return;
    setLoadingMore(true);
    try {
      const page = await load(urlFor(current.items.length));
      setLoaded((prev) => (prev ? { ...prev, items: [...prev.items, ...page.items], total: page.total, error: null } : prev));
    } catch (e) {
      setLoaded((prev) => (prev ? { ...prev, error: messageOf(e) } : prev));
    } finally {
      setLoadingMore(false);
    }
  }

  return { current, loadingMore, loadMore };
}

/**
 * The Invoices screen: the list of invoices (newest first, with status, store and date filters and a search) and the
 * "To invoice" tab, the confirmed orders still waiting for an invoice. The Home count is the length of that tab. The
 * filters live in the address, so a reload or a shared link shows the same list.
 */
export function InvoicesScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const params = useMemo<InvoiceListParams>(() => {
    const status = search.get("status");
    return {
      tab: search.get("tab") === "to-invoice" ? "to-invoice" : "invoices",
      status: status === "draft" || status === "issued" || status === "cancelled" ? status : "all",
      payment: ((p) => (p === "unpaid" || p === "partially_paid" || p === "paid" ? p : "all"))(search.get("pay")),
      store: search.get("store") ?? "",
      from: search.get("from") ?? "",
      to: search.get("to") ?? "",
      q: search.get("q") ?? "",
    };
  }, [search]);

  const setParams = useCallback(
    (patch: Partial<InvoiceListParams>) => {
      router.replace(invoicesScreenUrl({ ...params, ...patch }), { scroll: false });
    },
    [params, router],
  );

  // The search box updates the address after a short pause.
  const [qText, setQText] = useState(params.q);
  const debouncedQ = useDebouncedValue(qText, 300);
  useEffect(() => {
    if (debouncedQ.trim() !== params.q.trim()) setParams({ q: debouncedQ });
  }, [debouncedQ, params.q, setParams]);

  const [storeOpen, setStoreOpen] = useState(false);
  const storeInfo = useApiResource<Store>(params.store ? `/api/stores/${params.store}` : null);
  const [attempt, setAttempt] = useState(0);
  const today = todayInPakistan();

  const invoiceList = usePagedList<InvoiceSummaryRow>(
    useCallback((offset) => invoicesApiUrl(params, { limit: PAGE, offset }), [params]),
    getInvoicePage,
    params.tab === "invoices" ? attempt : -1,
  );
  const todoList = usePagedList<ToInvoiceRow>(
    useCallback((offset) => toInvoiceApiUrl(params.q, { limit: PAGE, offset }), [params.q]),
    getToInvoicePage,
    params.tab === "to-invoice" ? attempt : -2,
  );

  const tab: InvoiceTab = params.tab;
  const active = tab === "invoices" ? invoiceList : todoList;
  const current = active.current;
  const filtering = tab === "invoices" ? Boolean(params.status !== "all" || params.payment !== "all" || params.store || params.from || params.to || params.q.trim()) : Boolean(params.q.trim());

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Invoices</h1>

      <div role="tablist" aria-label="Invoice lists" className="flex gap-2">
        {(
          [
            { id: "invoices", label: "Invoices" },
            { id: "to-invoice", label: "To invoice" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            data-testid={`tab-${t.id}`}
            className={chip(tab === t.id)}
            onClick={() => setParams({ tab: t.id })}
          >
            {t.label}
            {t.id === "to-invoice" && todoList.current ? ` (${todoList.current.total.toLocaleString("en-US")})` : ""}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          type="search"
          aria-label="Search invoices"
          placeholder={tab === "invoices" ? "Invoice number or store name" : "Order number or store name"}
          value={qText}
          onChange={(e) => setQText(e.target.value)}
          dir="auto"
          className="min-h-11 w-full rounded-lg border border-border bg-surface py-2 pl-10 pr-3 text-base"
        />
      </div>

      {tab === "invoices" ? (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
            {STATUSES.map((s) => (
              <button key={s.value} type="button" aria-pressed={params.status === s.value} data-testid={`status-${s.value}`} className={chip(params.status === s.value)} onClick={() => setParams({ status: s.value })}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by payment">
            {PAYMENTS.map((p) => (
              <button key={p.value} type="button" aria-pressed={params.payment === p.value} data-testid={`payment-${p.value}`} className={chip(params.payment === p.value)} onClick={() => setParams({ payment: p.value })}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {params.store ? (
              <button type="button" className={chip(true)} onClick={() => setParams({ store: "" })} aria-label="Clear store filter" data-testid="store-chip">
                Store: {storeInfo.data?.name ?? "…"} <X size={18} className="ml-2" aria-hidden="true" />
              </button>
            ) : (
              <Button variant="secondary" onClick={() => setStoreOpen(true)} data-testid="filter-store">
                All stores
              </Button>
            )}
            <button
              type="button"
              aria-pressed={params.from === today && params.to === today}
              className={chip(params.from === today && params.to === today)}
              onClick={() => setParams(params.from === today && params.to === today ? { from: "", to: "" } : { from: today, to: today })}
            >
              Today
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="invoices-from" className="mb-1 block text-sm font-medium">
                From
              </label>
              <input id="invoices-from" type="date" value={params.from} max={params.to || undefined} onChange={(e) => setParams({ from: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label htmlFor="invoices-to" className="mb-1 block text-sm font-medium">
                To
              </label>
              <input id="invoices-to" type="date" value={params.to} min={params.from || undefined} onChange={(e) => setParams({ to: e.target.value })} className={inputClass} />
            </div>
          </div>
        </>
      ) : null}

      {!current ? (
        <LoadingBlock label={tab === "invoices" ? "Loading invoices…" : "Loading orders…"} />
      ) : current.error && current.items.length === 0 ? (
        <ErrorState message={current.error} onRetry={() => setAttempt((a) => a + 1)} />
      ) : current.items.length === 0 ? (
        filtering ? (
          <EmptyState
            icon={Search}
            title={tab === "invoices" ? "No invoices match" : "No orders match"}
            description="Try different filters."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setQText("");
                  router.replace(invoicesScreenUrl({ ...DEFAULT_LIST_PARAMS, tab }), { scroll: false });
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : tab === "invoices" ? (
          <EmptyState icon={FileText} title="No invoices yet" description="Open a confirmed order and tap Create invoice, or use the To invoice tab." action={<ButtonLink href="/orders">Go to orders</ButtonLink>} />
        ) : (
          <EmptyState icon={FileText} title="Nothing waiting for an invoice" description="Confirmed orders without an issued invoice appear here." action={<ButtonLink href="/orders">Go to orders</ButtonLink>} />
        )
      ) : (
        <>
          {tab === "invoices" ? (
            <ul className="space-y-3" data-testid="invoice-list">
              {invoiceList.current?.items.map((invoice) => <InvoiceListItem key={invoice.id} invoice={invoice} />)}
            </ul>
          ) : (
            <ToInvoiceList items={todoList.current?.items ?? []} />
          )}
          {current.error ? (
            <p role="alert" className="text-danger">
              {current.error}
            </p>
          ) : null}
          {current.items.length < current.total ? (
            <Button variant="secondary" className="w-full" onClick={() => void active.loadMore()} loading={active.loadingMore} data-testid="show-more">
              Show more
            </Button>
          ) : null}
        </>
      )}

      <Dialog open={storeOpen} title="Filter by store" onClose={() => setStoreOpen(false)}>
        <StoreSelector
          onSelect={(store) => {
            setStoreOpen(false);
            setParams({ store: store.id });
          }}
        />
        <Button variant="ghost" className="w-full" onClick={() => setStoreOpen(false)}>
          Close
        </Button>
      </Dialog>
    </div>
  );
}
