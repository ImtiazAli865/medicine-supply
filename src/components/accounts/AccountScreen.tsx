"use client";

import { BookOpen, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AdjustmentDialog } from "@/components/accounts/AdjustmentDialog";
import { BalanceBadge } from "@/components/accounts/BalanceBadge";
import { EntryRow } from "@/components/accounts/EntryRow";
import { OpeningBalanceDialog } from "@/components/accounts/OpeningBalanceDialog";
import { PendingSyncBadge, PendingSyncNote, useOnPaymentsConfirmed } from "@/components/accounts/PendingSyncNote";
import { RecordPaymentDialog } from "@/components/accounts/RecordPaymentDialog";
import { ReverseEntryDialog } from "@/components/accounts/ReverseEntryDialog";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LoadingBlock } from "@/components/ui/Spinner";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { accountApiUrl, getAccount, statementUrl } from "@/lib/accounts/client";
import { PAYMENT_STATUS_LABEL, balanceSentence } from "@/lib/accounts/status";
import type { AccountView, LedgerEntry } from "@/lib/accounts/types";
import { ClientApiError } from "@/lib/api/client";
import { useApiResource } from "@/lib/hooks/useApiResource";
import { formatInvoiceMoney } from "@/lib/invoices/status";

const PAGE = 30;

/**
 * One store account: the balance in words, what is still unpaid (oldest first), the actions, and the entries with a
 * running balance. Everything on this screen is worked out by the server from the entries; the screen only shows it.
 */
export function AccountScreen({ storeId }: { storeId: string }) {
  const first = useApiResource<AccountView>(accountApiUrl(storeId, { limit: PAGE, offset: 0 }));
  const [more, setMore] = useState<{ base: string; entries: LedgerEntry[]; error: string | null; loading: boolean }>({
    base: "",
    entries: [],
    error: null,
    loading: false,
  });
  const [openingOpen, setOpeningOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [reversing, setReversing] = useState<LedgerEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // A payment waiting on this phone was confirmed by the server: its entry is new, so the balance and the entries are read again.
  useOnPaymentsConfirmed(storeId, () => {
    setMore({ base: "", entries: [], error: null, loading: false });
    first.retry();
  });

  const account = first.data;
  // Entries loaded by "Show more" belong to the first page they were loaded after; a reload starts again.
  const key = account ? `${account.balance}#${account.total_entries}` : "";
  const extra = more.base === key ? more.entries : [];
  const entries = account ? [...account.entries, ...extra] : [];

  async function showMore() {
    if (!account || more.loading) return;
    setMore((m) => ({ ...m, base: key, loading: true, error: null }));
    try {
      const page = await getAccount(accountApiUrl(storeId, { limit: PAGE, offset: entries.length }));
      setMore((m) => ({ base: key, entries: [...(m.base === key ? m.entries : []), ...page.entries], error: null, loading: false }));
    } catch (e) {
      setMore((m) => ({ ...m, loading: false, error: e instanceof ClientApiError ? e.message : "Something went wrong. Please try again." }));
    }
  }

  function afterWrite(message: string) {
    setOpeningOpen(false);
    setPaymentOpen(false);
    setAdjustOpen(false);
    setReversing(null);
    setNotice(message);
    setMore({ base: "", entries: [], error: null, loading: false });
    first.retry();
  }

  if (first.loading && !account) return <LoadingBlock label="Loading account…" />;
  if (first.error || !account) return <ErrorState message={first.error ?? "Something went wrong. Please try again."} onRetry={first.retry} />;

  return (
    <div className="space-y-4">
      <Link href="/accounts" className="inline-flex min-h-11 items-center gap-1 text-primary">
        <ChevronLeft size={20} aria-hidden="true" /> Store accounts
      </Link>

      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold" dir="auto" data-testid="account-store-name">
          {account.store.name}
        </h1>
        {!account.store.is_active ? <Badge>Inactive</Badge> : null}
      </div>

      <section aria-label="Balance" className="space-y-2 rounded-xl border border-border bg-surface p-4" data-testid="account-balance-card">
        <div className="flex flex-wrap items-center gap-2">
          <BalanceBadge balance={account.balance} testId="account-balance" />
          <PendingSyncBadge storeId={storeId} />
        </div>
        <p className="text-lg" data-testid="account-balance-sentence">
          {balanceSentence(account.balance)}
        </p>
        <p className="text-sm text-muted">
          The balance is worked out from the entries below. It is never typed or stored.
        </p>
      </section>

      <PendingSyncNote storeId={storeId} />

      {notice ? (
        <p role="status" className="rounded-lg border border-primary/30 bg-primary-soft px-3 py-2 text-primary-strong" data-testid="account-notice">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button data-testid="open-payment" onClick={() => setPaymentOpen(true)}>
          Record payment
        </Button>
        <Button variant="secondary" data-testid="open-opening" onClick={() => setOpeningOpen(true)}>
          Add opening balance
        </Button>
        <Button variant="secondary" data-testid="open-adjustment" onClick={() => setAdjustOpen(true)}>
          Adjust balance
        </Button>
        <Link
          href={statementUrl(storeId)}
          className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 font-medium text-primary"
          data-testid="open-statement"
        >
          Statement
        </Link>
      </div>

      {account.open_items.length > 0 ? (
        <section aria-labelledby="open-items-heading" className="space-y-2">
          <h2 id="open-items-heading" className="text-lg font-semibold">
            Still unpaid
          </h2>
          <ul className="space-y-2" data-testid="open-items">
            {account.open_items.map((item) => (
              <li key={item.entry_id} className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-2" data-testid="open-item">
                <span className="min-w-0">
                  <span className="block font-medium">{item.label}</span>
                  <span className="block text-sm text-muted">{item.date}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-semibold">{formatInvoiceMoney(item.outstanding)}</span>
                  <span className="block text-sm text-muted">
                    {PAYMENT_STATUS_LABEL[item.status]}
                    {item.status === "partially_paid" ? ` · of ${formatInvoiceMoney(item.amount)}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="entries-heading" className="space-y-2">
        <h2 id="entries-heading" className="text-lg font-semibold">
          Entries
        </h2>
        {entries.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No entries yet"
            description="Add an opening balance if this store already owes you money from before. Invoices you issue and payments you record will appear here."
            action={<Button onClick={() => setOpeningOpen(true)}>Add opening balance</Button>}
          />
        ) : (
          <>
            <ul className="space-y-2" data-testid="entry-list">
              {entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} onReverse={setReversing} />
              ))}
            </ul>
            {more.error ? (
              <p role="alert" className="text-sm text-danger">
                {more.error}
              </p>
            ) : null}
            {entries.length < account.total_entries ? (
              <Button variant="secondary" loading={more.loading} onClick={() => void showMore()} data-testid="entries-more">
                Show more entries
              </Button>
            ) : null}
          </>
        )}
      </section>

      <OpeningBalanceDialog open={openingOpen} storeId={storeId} onClose={() => setOpeningOpen(false)} onDone={() => afterWrite("Opening balance saved.")} />
      <RecordPaymentDialog
        open={paymentOpen}
        storeId={storeId}
        onClose={() => setPaymentOpen(false)}
        onDone={() => afterWrite("Payment saved.")}
        onKept={() => {
          setPaymentOpen(false);
          setNotice("Saved on this phone. It is not in the store's account until it is sent.");
        }}
      />
      <AdjustmentDialog open={adjustOpen} storeId={storeId} onClose={() => setAdjustOpen(false)} onDone={() => afterWrite("Adjustment saved.")} />
      <ReverseEntryDialog entry={reversing} storeId={storeId} onClose={() => setReversing(null)} onDone={() => afterWrite("Entry reversed.")} />
    </div>
  );
}
