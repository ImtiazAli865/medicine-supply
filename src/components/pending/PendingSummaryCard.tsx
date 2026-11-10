"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import type { PendingSummary } from "@/lib/pending/types";

type State = { key: number; summary: PendingSummary | null; error: string | null };

/**
 * Home: what needs attention. The numbers come straight from the summary, which always equals the length of the
 * lists they link to. Fetched when Home opens, never cached. A failed request shows an error with Retry, never
 * "nothing pending".
 */
export function PendingSummaryCard() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<PendingSummary>("/api/pending/summary")
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
    <section aria-labelledby="attention-heading" className="space-y-2" data-testid="pending-summary">
      <h2 id="attention-heading" className="text-lg font-semibold">
        Needs attention
      </h2>
      {!current ? (
        <div role="status" aria-label="Loading" className="h-20 animate-pulse rounded-xl border border-border bg-slate-100" data-testid="pending-summary-loading" />
      ) : current.error || !current.summary ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-danger" data-testid="pending-summary-error">
          <span className="flex items-center gap-2">
            <AlertCircle size={20} aria-hidden="true" />
            {current.error ?? "Something went wrong. Please try again."}
          </span>
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </Button>
        </div>
      ) : current.summary.typed_groups === 0 && current.summary.price_items === 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-muted" data-testid="pending-summary-clear">
          <CheckCircle2 size={20} className="text-primary" aria-hidden="true" />
          Nothing needs attention.
        </p>
      ) : (
        <ul className="space-y-2">
          {current.summary.typed_groups > 0 ? (
            <li>
              <Link
                href="/pending?tab=register"
                data-testid="pending-typed-link"
                className="flex min-h-14 items-center rounded-xl border border-warning/40 bg-warning-soft px-4 py-2 font-medium text-warning hover:border-warning"
              >
                <span data-testid="pending-typed-count">
                  {current.summary.typed_groups.toLocaleString("en-US")} typed {current.summary.typed_groups === 1 ? "medicine" : "medicines"} to register
                </span>
              </Link>
            </li>
          ) : null}
          {current.summary.price_items > 0 ? (
            <li>
              <Link
                href="/pending?tab=prices"
                data-testid="pending-price-link"
                className="flex min-h-14 items-center rounded-xl border border-warning/40 bg-warning-soft px-4 py-2 font-medium text-warning hover:border-warning"
              >
                <span data-testid="pending-price-count">
                  {current.summary.price_items.toLocaleString("en-US")} {current.summary.price_items === 1 ? "medicine needs" : "medicines need"} a price (
                  {current.summary.price_items_with_waiting_lines.toLocaleString("en-US")} {current.summary.price_items_with_waiting_lines === 1 ? "has" : "have"} orders waiting)
                </span>
              </Link>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
