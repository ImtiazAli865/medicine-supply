"use client";

import { ClipboardList, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PendingLineActions } from "@/components/pending/PendingLineActions";
import { usePendingProposals } from "@/components/pending/ProposalsFlow";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { LoadingBlock } from "@/components/ui/Spinner";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import { useSearchList } from "@/lib/hooks/useSearchList";
import { formatOrderNumber } from "@/lib/orders/number";
import type { Order } from "@/lib/orders/types";
import type { TypedGroup, TypedLine } from "@/lib/pending/types";

/** The saved version of an order, read when a dialog opens so a change made elsewhere is seen. */
async function currentVersion(orderId: string): Promise<{ ok: true; version: number } | { ok: false; message: string }> {
  try {
    const { data } = await fetchJson<Order>(`/api/orders/${orderId}`);
    if (data.status === "cancelled") return { ok: false, message: "This order was cancelled and can no longer be changed." };
    return { ok: true, version: data.version };
  } catch (error) {
    return { ok: false, message: error instanceof ClientApiError ? error.message : "Something went wrong. Please try again." };
  }
}

function LineRow({ line, onChanged, offer }: { line: TypedLine; onChanged: () => void; offer: ReturnType<typeof usePendingProposals>["offer"] }) {
  return (
    <li className="space-y-2 rounded-lg border border-border p-3" data-testid="typed-line">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/orders/${line.order_id}`} className="inline-flex min-h-11 items-center font-medium text-primary underline" data-testid="typed-line-order">
          {formatOrderNumber(line.order_number)}
        </Link>
        <span dir="auto" data-testid="typed-line-store">
          {line.store_name}
        </span>
        <Badge tone={line.order_status === "draft" ? "neutral" : "success"}>{line.order_status === "draft" ? "Draft" : "Confirmed"}</Badge>
      </div>
      <p className="text-sm text-muted" data-testid="typed-line-qty">
        {line.quantity.toLocaleString("en-US")} {line.unit}
        <span dir="auto"> · typed as “{line.typed_text}”</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <PendingLineActions
          orderId={line.order_id}
          orderStatus={line.order_status}
          line={{ id: line.line_id, name: line.typed_text, unit: line.unit, quantity: line.quantity }}
          getVersion={() => currentVersion(line.order_id)}
          onOrderChanged={() => onChanged()}
          onLinked={(product) => void offer(product)}
        />
      </div>
    </li>
  );
}

/**
 * Typed (not registered) medicines on draft and confirmed orders, grouped by what was typed, so the same
 * medicine typed in several orders is seen once. Each line can be registered or linked to an existing medicine.
 */
export function TypedGroupList() {
  const [query, setQuery] = useState("");
  const list = useSearchList<TypedGroup>("/api/pending/typed", query, "active");
  // A line linked from the proposals list must also leave this list.
  const proposals = usePendingProposals(null, undefined, list.retry);
  const searching = list.activeQuery !== "";

  return (
    <div className="space-y-4" data-testid="pending-typed">
      <div className="relative">
        <Search size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          type="search"
          aria-label="Search typed medicines"
          placeholder="Search what was typed…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          dir="auto"
          className="min-h-11 w-full rounded-lg border border-border bg-surface py-2 pl-10 pr-3 text-base"
        />
      </div>

      {list.error && list.items.length === 0 ? (
        <ErrorState message={list.error} onRetry={list.retry} />
      ) : list.loading && list.items.length === 0 ? (
        <LoadingBlock label="Loading typed medicines…" />
      ) : list.items.length === 0 ? (
        searching ? (
          <EmptyState icon={Search} title="No typed medicines match" description="Try different words." />
        ) : (
          <EmptyState
            icon={ClipboardList}
            title="Nothing to register"
            description="Every medicine on your orders is in your catalog. A medicine typed on an order that is not in the catalog will wait here until you register it."
            action={
              <ButtonLink href="/orders/new" variant="secondary">
                Take an order
              </ButtonLink>
            }
          />
        )
      ) : (
        <>
          {list.error ? <ErrorState message={list.error} onRetry={list.retry} /> : null}
          <ul className="space-y-3" aria-busy={list.loading}>
            {list.items.map((group) => (
              <li key={group.typed_text.toLowerCase()} className="space-y-2 rounded-xl border border-border bg-surface p-3" data-testid="typed-group">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="min-w-0 text-lg font-semibold" dir="auto" data-testid="typed-group-text">
                    {group.typed_text}
                  </h2>
                  <span className="shrink-0 text-sm text-muted" data-testid="typed-group-count">
                    {group.line_count} {group.line_count === 1 ? "line" : "lines"}
                  </span>
                </div>
                <ul className="space-y-2">
                  {group.lines.map((line) => (
                    <LineRow key={line.line_id} line={line} onChanged={list.retry} offer={proposals.offer} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {list.hasMore ? (
            <Button variant="secondary" onClick={list.loadMore} loading={list.loadingMore} className="w-full">
              Load more
            </Button>
          ) : null}
        </>
      )}
      {proposals.element}
    </div>
  );
}
