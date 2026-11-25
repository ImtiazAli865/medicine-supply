"use client";

import { BookOpen } from "lucide-react";
import { useMemo } from "react";
import { AccountListItem } from "@/components/accounts/AccountListItem";
import { PendingSyncTotalNote } from "@/components/accounts/PendingSyncNote";
import { ButtonLink } from "@/components/ui/Button";
import { accountsApiUrl } from "@/lib/accounts/client";
import { formatAccountMoney } from "@/lib/accounts/status";
import type { AccountPage, AccountsSummary } from "@/lib/accounts/types";
import { reportUrl, useReport } from "@/lib/reports/client";
import { plural } from "@/lib/reports/labels";
import type { NotInAccount } from "@/lib/reports/types";
import { Pager } from "./Pager";
import { ReportShell } from "./ReportShell";
import { usePeriod } from "./usePeriod";

const PAGE = 20;

/**
 * Outstanding balances: every store with its balance, worked out from its ledger entries by the same functions Home and
 * Store accounts use (so the total can never disagree with Home). Stores that owe come first; an advance is shown as an
 * advance and is not taken off the total owed. There is no period: it is the balances as they are now.
 */
export function BalancesReportScreen() {
  const period = usePeriod();
  const { offset } = period;
  const listUrl = useMemo(() => accountsApiUrl({ q: "", onlyOwing: false }, { limit: PAGE, offset }), [offset]);
  const summary = useReport<AccountsSummary>("/api/accounts/summary");
  const list = useReport<AccountPage>(listUrl);
  const note = useReport<NotInAccount>(reportUrl("/api/reports/balances-note", {}));

  const loading = summary.loading || list.loading;
  const failure = summary.error ?? list.error;
  const status = loading ? "loading" : failure !== undefined || !summary.data || !list.data ? "error" : list.data.total === 0 ? "empty" : "ready";

  return (
    <ReportShell
      title="Outstanding balances"
      description="What each store owes you now, from its account entries."
      status={status}
      errorMessage={failure}
      onRetry={() => {
        summary.retry();
        list.retry();
        note.retry();
      }}
      empty={{
        icon: BookOpen,
        title: "No stores yet",
        description: "Add a store first. Its account starts at 0 and fills as you issue invoices and record payments.",
        action: <ButtonLink href="/stores/new">Add a store</ButtonLink>,
      }}
      exportHref={reportUrl("/api/reports/export", { report: "balances" })}
    >
      {summary.data && list.data ? (
        <div className="space-y-4">
          <section aria-label="Total owed" className="space-y-1 rounded-xl border border-border bg-surface p-4" data-testid="balances-total">
            <p className="text-sm text-muted">Total owed to you</p>
            <p className="text-3xl font-semibold" data-testid="balances-total-owed">
              {formatAccountMoney(summary.data.total_owed)}
            </p>
            <p className="text-sm text-muted">
              Owed by {summary.data.stores_owing} {plural(summary.data.stores_owing, "store", "stores")}.
              {summary.data.stores_with_advance > 0
                ? ` ${summary.data.stores_with_advance} ${plural(summary.data.stores_with_advance, "store has", "stores have")} paid ${formatAccountMoney(summary.data.total_advance)} in advance; advances are not taken off this total.`
                : ""}
            </p>
          </section>

          <PendingSyncTotalNote />

          {note.data && note.data.invoices > 0 ? (
            <p className="text-sm text-muted" data-testid="balances-not-in-account">
              {note.data.invoices} {plural(note.data.invoices, "invoice", "invoices")} issued before store accounts existed ({formatAccountMoney(note.data.total)}) {plural(note.data.invoices, "is", "are")} not in any balance.
            </p>
          ) : null}
          {note.error ? (
            <p className="text-sm text-muted" data-testid="balances-note-error">
              The note about older invoices could not be loaded.
            </p>
          ) : null}

          <ul className="space-y-2" data-testid="account-list">
            {list.data.items.map((row) => (
              <AccountListItem key={row.store_id} row={row} />
            ))}
          </ul>
          <Pager offset={offset} pageSize={PAGE} shown={list.data.items.length} total={list.data.total} onOffset={period.setOffset} />
        </div>
      ) : null}
    </ReportShell>
  );
}
