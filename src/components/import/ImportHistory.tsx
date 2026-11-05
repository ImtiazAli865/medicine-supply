"use client";

import Link from "next/link";
import { ErrorState } from "@/components/ui/States";
import { LoadingBlock } from "@/components/ui/Spinner";
import { useApiResource } from "@/lib/hooks/useApiResource";
import type { ImportSummary } from "@/lib/import/types";

export function ImportHistory() {
  const { data, error, loading, retry } = useApiResource<{ items: ImportSummary[] }>("/api/imports?limit=20");

  return (
    <section aria-labelledby="history-title" className="space-y-2">
      <h2 id="history-title" className="text-lg font-semibold">Earlier imports</h2>
      {loading ? (
        <LoadingBlock label="Loading earlier imports…" />
      ) : error || !data ? (
        <ErrorState message={error ?? "Could not load earlier imports."} onRetry={retry} />
      ) : data.items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface p-4 text-muted" data-testid="history-empty">
          No imports yet. Choose a file above to import your first list.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface" data-testid="history-list">
          {data.items.map((i) => (
            <li key={i.id}>
              <Link href={`/products/import?import=${i.id}`} className="flex min-h-14 flex-col justify-center gap-0.5 px-4 py-3 hover:bg-slate-50">
                <span className="truncate font-medium" dir="auto">{i.file_name}</span>
                <span className="text-sm text-muted">
                  {new Date(i.created_at).toLocaleString("en-GB")} · {i.created_count.toLocaleString("en-US")} created · {i.skipped_count.toLocaleString("en-US")} skipped
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
