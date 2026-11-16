"use client";

import { AlertCircle, BookOpen } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { getAccountsSummary } from "@/lib/accounts/client";
import { formatAccountMoney } from "@/lib/accounts/status";
import type { AccountsSummary } from "@/lib/accounts/types";
import { ClientApiError } from "@/lib/api/client";

type State = { key: number; summary: AccountsSummary | null; error: string | null };

/**
 * Home: the total the stores owe and how many stores owe it, worked out from the entries by the server (never a stored
 * number). Fetched when Home opens, never cached. A failed request shows an error with Retry, never "nothing owed".
 */
export function AccountsSummaryCard() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAccountsSummary()
      .then((summary) => {
        if (!cancelled) setState({ key: attempt, summary, error: null });
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
    <section aria-labelledby="accounts-heading" className="space-y-2" data-testid="accounts-summary">
      <h2 id="accounts-heading" className="text-lg font-semibold">
        Store accounts
      </h2>
      {!current ? (
        <div role="status" aria-label="Loading" className="h-16 animate-pulse rounded-xl border border-border bg-slate-100" data-testid="accounts-summary-loading" />
      ) : current.error || !current.summary ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-danger" data-testid="accounts-summary-error">
          <span className="flex items-center gap-2">
            <AlertCircle size={20} aria-hidden="true" />
            {current.error ?? "Something went wrong. Please try again."}
          </span>
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </Button>
        </div>
      ) : current.summary.stores_owing === 0 ? (
        <Link href="/accounts" data-testid="accounts-summary-link" className="flex min-h-14 items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 font-medium hover:border-primary">
          <BookOpen size={20} className="text-primary" aria-hidden="true" />
          <span data-testid="accounts-summary-text">No store owes you anything.</span>
        </Link>
      ) : (
        <Link
          href="/accounts?owing=1"
          data-testid="accounts-summary-link"
          className="flex min-h-14 items-center gap-2 rounded-xl border border-warning/40 bg-warning-soft px-4 py-2 font-medium text-warning hover:border-warning"
        >
          <BookOpen size={20} aria-hidden="true" />
          <span data-testid="accounts-summary-text">
            {formatAccountMoney(current.summary.total_owed)} owed by {current.summary.stores_owing.toLocaleString("en-US")}{" "}
            {current.summary.stores_owing === 1 ? "store" : "stores"}
          </span>
        </Link>
      )}
    </section>
  );
}
