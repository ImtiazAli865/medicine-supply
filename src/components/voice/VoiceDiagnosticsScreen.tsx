"use client";

import { ClipboardList } from "lucide-react";
import { useCallback } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { LoadingBlock } from "@/components/ui/Spinner";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { usePagedList } from "@/lib/hooks/usePagedList";
import { formatPakistanDateTime } from "@/lib/orders/dates";
import { diagnosticsUrl, getDiagnostics } from "@/lib/voice/client";
import type { DiagnosticKind, DiagnosticRecord } from "@/lib/voice/types";

const PAGE = 20;

const KIND_LABELS: Record<DiagnosticKind, string> = {
  ai_busy: "Voice service busy",
  ai_timeout: "Voice service too slow",
  ai_invalid: "Unusable answer",
  ai_not_configured: "Voice service not set up",
  ai_unavailable: "Voice service unavailable",
  rate_limited: "Limit reached",
  rules_unreadable: "Simple reader could not read it",
  low_confidence: "Needed a closer look",
};

const PARSER_LABELS = { ai: "Voice service", rules: "Simple reader" } as const;

function Row({ record }: { record: DiagnosticRecord }) {
  return (
    <li data-testid="voice-diagnostic" data-kind={record.kind} className="space-y-1 rounded-xl border border-border bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="font-semibold" data-testid="voice-diagnostic-kind">
          {KIND_LABELS[record.kind] ?? record.kind}
        </p>
        <p className="text-sm text-muted" data-testid="voice-diagnostic-time">
          {formatPakistanDateTime(record.created_at)}
        </p>
      </div>
      <p className="text-sm text-muted">
        {PARSER_LABELS[record.parser] ?? record.parser}. Items {record.item_count}, doubtful {record.doubtful_count}, unreadable {record.unreadable_count}. Text length {record.transcript_length} characters.
      </p>
      {record.message ? <p className="text-sm">{record.message}</p> : null}
    </li>
  );
}

/**
 * The voice diagnostic log: when the voice service failed or an answer needed a closer look. Read only. It never shows
 * what was said, only counts and the length of the text, so the log cannot leak an order, a price or a secret.
 */
export function VoiceDiagnosticsScreen() {
  const urlFor = useCallback((offset: number) => diagnosticsUrl(PAGE, offset), []);
  const list = usePagedList<DiagnosticRecord>(urlFor, getDiagnostics);
  const current = list.current;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Voice diagnostics</h1>
        <p className="text-muted">
          A short record of voice problems, newest first. It holds counts and the length of the text only, never what was said and never a key.
        </p>
      </div>

      {!current ? (
        <LoadingBlock label="Loading voice diagnostics…" />
      ) : current.error && current.items.length === 0 ? (
        <ErrorState message={current.error} onRetry={list.retry} />
      ) : current.items.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No voice problems recorded"
          description="Nothing has gone wrong with voice orders. A record appears here when the voice service fails or an answer needs a closer look."
          action={<ButtonLink href="/orders/new">Take an order</ButtonLink>}
        />
      ) : (
        <>
          <ul className="space-y-2" data-testid="voice-diagnostic-list">
            {current.items.map((record) => (
              <Row key={record.id} record={record} />
            ))}
          </ul>
          {current.error ? (
            <p role="alert" className="text-sm text-danger">
              {current.error}
            </p>
          ) : null}
          {current.items.length < current.total ? (
            <Button variant="secondary" loading={list.loadingMore} onClick={() => void list.loadMore()} data-testid="voice-diagnostics-more">
              Show more
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
