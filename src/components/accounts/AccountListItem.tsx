"use client";

import Link from "next/link";
import { BalanceBadge } from "@/components/accounts/BalanceBadge";
import { PendingSyncBadge, PendingSyncRowNote } from "@/components/accounts/PendingSyncNote";
import { Badge } from "@/components/ui/Badge";
import { accountUrl } from "@/lib/accounts/client";
import type { AccountRow } from "@/lib/accounts/types";

/**
 * One store in the Store accounts list: its name and balance. A 44 px or taller row. While a payment of this store waits on this
 * phone, the balance is marked "Pending sync" and the row says how many payments are not counted yet.
 */
export function AccountListItem({ row }: { row: AccountRow }) {
  return (
    <li>
      <Link
        href={accountUrl(row.store_id)}
        data-testid="account-item"
        className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 hover:border-primary"
      >
        <span className="min-w-0">
          <span className="block truncate font-semibold" dir="auto" data-testid="account-item-name">
            {row.name}
          </span>
          <span className="block text-sm text-muted">
            {row.entry_count === 0 ? "No entries yet" : `${row.entry_count.toLocaleString("en-US")} ${row.entry_count === 1 ? "entry" : "entries"}`}
            {row.last_entry_date ? ` · last ${row.last_entry_date}` : ""}
          </span>
          <PendingSyncRowNote storeId={row.store_id} />
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <BalanceBadge balance={row.balance} testId="account-item-balance" />
          <PendingSyncBadge storeId={row.store_id} testId="account-item-pending-badge" />
          {!row.is_active ? <Badge>Inactive</Badge> : null}
        </span>
      </Link>
    </li>
  );
}
