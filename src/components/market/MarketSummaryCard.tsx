"use client";

import { AlertCircle, CheckCircle2, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import type { MarketSummary } from "@/lib/market/types";

type State = { key: number; summary: MarketSummary | null; error: string | null };

/**
 * Home: how many medicines are still to buy today. The number comes from the same rows as the market list, so it
 * always equals the "Still to buy" list. Fetched when Home opens, never cached. A failed request shows an error
 * with Retry, never "nothing to buy".
 */
export function MarketSummaryCard() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<MarketSummary>("/api/market-list/summary")
      .then(({ data }) => {
        if (!cancelled) setState({ key: attempt, summary: data, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ key: attempt, summary: null, error: error instanceof ClientApiError ? error.message : "Something went wrong. Please try again." });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const current = state?.key === attempt ? state : null;

  return (
    <section aria-labelledby="market-heading" className="space-y-2" data-testid="market-summary">
      <h2 id="market-heading" className="text-lg font-semibold">
        Market list
      </h2>
      {!current ? (
        <div role="status" aria-label="Loading" className="h-16 animate-pulse rounded-xl border border-border bg-slate-100" data-testid="market-summary-loading" />
      ) : current.error || !current.summary ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-danger" data-testid="market-summary-error">
          <span className="flex items-center gap-2">
            <AlertCircle size={20} aria-hidden="true" />
            {current.error ?? "Something went wrong. Please try again."}
          </span>
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </Button>
        </div>
      ) : current.summary.rows_total === 0 ? (
        <p className="flex flex-wrap items-center gap-x-2 rounded-xl border border-border bg-surface px-4 py-3 text-muted" data-testid="market-summary-none">
          <ShoppingCart size={20} className="text-primary" aria-hidden="true" />
          No confirmed orders today. Take or confirm an order.
        </p>
      ) : current.summary.rows_to_buy === 0 ? (
        <Link href="/market-list" data-testid="market-summary-link" className="flex min-h-14 items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 font-medium hover:border-primary">
          <CheckCircle2 size={20} className="text-primary" aria-hidden="true" />
          <span data-testid="market-summary-count">Nothing left to buy today.</span>
        </Link>
      ) : (
        <Link
          href="/market-list?status=to_buy"
          data-testid="market-summary-link"
          className="flex min-h-14 items-center gap-2 rounded-xl border border-warning/40 bg-warning-soft px-4 py-2 font-medium text-warning hover:border-warning"
        >
          <ShoppingCart size={20} aria-hidden="true" />
          <span data-testid="market-summary-count">
            Market list: {current.summary.rows_to_buy.toLocaleString("en-US")} {current.summary.rows_to_buy === 1 ? "medicine" : "medicines"} to buy today
          </span>
        </Link>
      )}
    </section>
  );
}
