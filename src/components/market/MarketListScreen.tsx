"use client";

import { ChevronLeft, ChevronRight, ClipboardList, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Banner, EmptyState, ErrorState } from "@/components/ui/States";
import { LoadingBlock } from "@/components/ui/Spinner";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { useMarketList } from "@/lib/hooks/useMarketList";
import { marketScreenUrl, type ListParams } from "@/lib/market/client";
import { formatDay, shiftDay } from "@/lib/market/status";
import type { MarketRow, MarketStatusFilter } from "@/lib/market/types";
import { formatPakistanTime, todayInPakistan } from "@/lib/orders/dates";
import { MarketRowCard } from "./MarketRowCard";
import { StoreFilter } from "./StoreFilter";
import { UnregisteredGroup } from "./UnregisteredGroup";

const STATUSES: Array<{ value: MarketStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "to_buy", label: "Still to buy" },
  { value: "bought", label: "Bought" },
];

const chip = (active: boolean) =>
  `inline-flex min-h-11 items-center rounded-lg px-4 text-base font-medium ${active ? "bg-primary text-white" : "border border-border bg-surface text-foreground"}`;
const inputClass = "min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base";

interface Props {
  initial: ListParams;
  /** The purchase buttons of a registered row (added by the purchase recording screens). */
  rowActions?: (row: MarketRow, list: { date: string; reload: () => void }) => React.ReactNode;
  /** The "Register this medicine" link of a typed row. */
  typedActions?: (row: MarketRow) => React.ReactNode;
  /** Extra buttons next to the heading (print and export). */
  toolbar?: (params: ListParams, disabled: boolean) => React.ReactNode;
}

/**
 * The consolidated market list of one Pakistan day: every medicine once with its total and each store's share,
 * a separate group for typed medicines that are not registered yet, and how much is bought. Search, filters and
 * the date are kept in the page address. No price or cost is ever shown here.
 */
export function MarketListScreen({ initial, rowActions, typedActions, toolbar }: Props) {
  const [date, setDate] = useState(initial.date);
  const [qInput, setQInput] = useState(initial.q);
  const q = useDebouncedValue(qInput);
  const [status, setStatus] = useState<MarketStatusFilter>(initial.status);
  const [stores, setStores] = useState<string[]>(initial.stores);
  const params = useMemo<ListParams>(() => ({ date, q, status, stores }), [date, q, status, stores]);
  const list = useMarketList(params);
  const today = todayInPakistan();

  // Keep the choices in the address so a reload or a shared link shows the same list.
  useEffect(() => {
    window.history.replaceState(null, "", marketScreenUrl(params));
  }, [params]);

  const filtering = q.trim() !== "" || status !== "all" || stores.length > 0;
  const data = list.data;
  const empty = data !== undefined && data.rows.length === 0 && data.typed_rows.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Market list</h1>
        <div className="flex flex-wrap gap-2">
          {toolbar ? toolbar(params, !data) : null}
          <Button variant="secondary" onClick={list.refresh} loading={list.updating} data-testid="market-refresh">
            <RefreshCw size={20} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex items-end gap-2" data-testid="market-date-bar">
        <Button variant="secondary" aria-label="Previous day" onClick={() => setDate(shiftDay(date, -1))}>
          <ChevronLeft size={20} aria-hidden="true" />
        </Button>
        <div className="min-w-0 flex-1">
          <label htmlFor="market-date" className="mb-1 block text-sm font-medium">
            Orders confirmed on
          </label>
          <input id="market-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={inputClass} data-testid="market-date" />
        </div>
        <Button variant="secondary" aria-label="Next day" onClick={() => setDate(shiftDay(date, 1))}>
          <ChevronRight size={20} aria-hidden="true" />
        </Button>
      </div>
      <p className="text-sm text-muted">
        {formatDay(date)}
        {date === today ? " (today)" : ""}
        {date !== today ? (
          <>
            {" · "}
            <button type="button" onClick={() => setDate(today)} className="min-h-11 text-primary underline">
              Go to today
            </button>
          </>
        ) : null}
      </p>

      <div className="relative">
        <Search size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          type="search"
          aria-label="Search the market list"
          placeholder="Search by medicine name"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          dir="auto"
          className="min-h-11 w-full rounded-lg border border-border bg-surface py-2 pl-10 pr-3 text-base"
          data-testid="market-search"
        />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by purchase status">
        {STATUSES.map((s) => (
          <button key={s.value} type="button" aria-pressed={status === s.value} className={chip(status === s.value)} onClick={() => setStatus(s.value)} data-testid={`market-status-${s.value}`}>
            {s.label}
          </button>
        ))}
      </div>

      {data ? <StoreFilter stores={data.stores} selected={stores} onChange={setStores} /> : null}
      {stores.length > 0 ? <Banner kind="info">Bought and remaining figures are for the whole day, not only the selected stores.</Banner> : null}

      {list.loading && !data ? (
        <LoadingBlock label="Loading the market list…" />
      ) : list.error && !data ? (
        <ErrorState message={list.error} onRetry={list.refresh} />
      ) : data ? (
        <>
          {list.error ? <ErrorState message={list.error} onRetry={list.refresh} /> : null}
          {data.truncated ? <Banner kind="error">Too many rows to show. Narrow the list with a store or a search.</Banner> : null}

          {empty ? (
            filtering ? (
              <EmptyState
                icon={Search}
                title="No medicines match"
                description="Try another word, status or store."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQInput("");
                      setStatus("all");
                      setStores([]);
                    }}
                  >
                    Clear the search and filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={ClipboardList}
                title="No confirmed orders for this date"
                description="Take or confirm an order, and its medicines appear here."
                action={<ButtonLink href="/orders/new">Take an order</ButtonLink>}
              />
            )
          ) : (
            <>
              <p className="text-sm text-muted" data-testid="market-count">
                {data.totals.rows} {data.totals.rows === 1 ? "medicine" : "medicines"}
                {data.totals.typed_rows > 0 ? `, ${data.totals.typed_rows} not registered yet` : ""}
                {data.generated_at ? ` · Updated ${formatPakistanTime(list.updatedAt ?? data.generated_at)}` : ""}
              </p>
              {data.rows.length > 0 ? (
                <ul className="space-y-3" data-testid="market-rows">
                  {data.rows.map((row) => (
                    <MarketRowCard key={row.key} row={row} storeFilterOn={stores.length > 0} actions={rowActions ? rowActions(row, { date: data.date, reload: list.refresh }) : undefined} />
                  ))}
                </ul>
              ) : null}
              <UnregisteredGroup rows={data.typed_rows} actions={typedActions} />
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
