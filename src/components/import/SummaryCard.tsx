"use client";

import { CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { LoadingBlock } from "@/components/ui/Spinner";
import { useApiResource } from "@/lib/hooks/useApiResource";
import type { ImportSummary } from "@/lib/import/types";
import { STATUS_LABEL, STATUS_TONE } from "./status";

/** The saved result of one import, loaded from the server so a refresh shows the same summary. */
export function ImportSummaryView({ id }: { id: string }) {
  const { data, error, loading, retry } = useApiResource<ImportSummary>(`/api/imports/${id}`);

  if (loading) return <LoadingBlock label="Loading import summary…" />;
  if (error || !data) return <ErrorState message={error ?? "This import could not be found."} onRetry={retry} />;

  const skipped = data.skipped ?? [];
  return (
    <div className="space-y-4" data-testid="import-summary">
      <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary-soft p-4">
        <CheckCircle2 size={28} className="mt-0.5 shrink-0 text-primary-strong" aria-hidden="true" />
        <div>
          <h2 className="text-lg font-semibold text-primary-strong">Import finished</h2>
          <p dir="auto" className="break-words text-sm">{data.file_name} · {new Date(data.created_at).toLocaleString("en-GB")}</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-surface p-4">
          <dt className="text-sm text-muted">Created</dt>
          <dd className="text-2xl font-semibold" data-testid="summary-created">{data.created_count.toLocaleString("en-US")}</dd>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <dt className="text-sm text-muted">Skipped</dt>
          <dd className="text-2xl font-semibold" data-testid="summary-skipped">{data.skipped_count.toLocaleString("en-US")}</dd>
        </div>
      </dl>
      {data.created_similar_count > 0 ? (
        <p>{data.created_similar_count.toLocaleString("en-US")} of the created medicines were similar ones you chose to add as separate products.</p>
      ) : null}
      <p className="text-sm text-muted">{data.submitted_rows.toLocaleString("en-US")} rows were read from the file.</p>

      {skipped.length > 0 ? (
        <section aria-labelledby="skipped-title" className="space-y-2">
          <h3 id="skipped-title" className="text-lg font-semibold">Skipped rows</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface" data-testid="skipped-list">
            {skipped.map((s) => (
              <li key={s.row_no} className="flex items-start justify-between gap-3 px-4 py-3">
                <p className="min-w-0 text-sm" dir="auto"><span className="font-medium">Row {s.row_no}:</span> {s.message}</p>
                <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/products">View medicines</ButtonLink>
        <ButtonLink href="/products/import" variant="secondary">Import another file</ButtonLink>
      </div>
    </div>
  );
}
