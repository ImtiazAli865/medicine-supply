"use client";

import { Repeat } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/States";
import { ClientApiError } from "@/lib/api/client";
import { formatPakistanDateTime } from "@/lib/orders/dates";
import type { RepeatPlan, RepeatSource, SkippedLine } from "@/lib/orders/fast-types";
import { formatOrderNumber } from "@/lib/orders/number";

const REASON_TEXT: Record<SkippedLine["reason"], string> = {
  inactive: "no longer active",
  missing: "no longer in your catalog",
  over_limit: "did not fit in the 200-line limit",
};

function lineWord(count: number): string {
  return count === 1 ? "line" : "lines";
}

/**
 * "Repeat last order": one tap copies the lines of the store's latest confirmed order into this draft (quantity and unit,
 * never a price). The button is shown only while the draft has no lines. Anything left out stays listed until dismissed.
 */
export function RepeatLastOrder({
  source,
  hasLines,
  disabled = false,
  fetchRepeat,
  onApply,
}: {
  source: RepeatSource | null;
  hasLines: boolean;
  disabled?: boolean;
  fetchRepeat: (orderId: string) => Promise<RepeatPlan>;
  /** Adds all lines in one change and returns how many were added and how many did not fit. */
  onApply: (plan: RepeatPlan, source: RepeatSource) => { added: number; refused: number };
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<SkippedLine[]>([]);
  const running = useRef(false); // blocks a second tap before React has re-rendered

  async function repeat() {
    if (!source || running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const plan = await fetchRepeat(source.order_id);
      const { added, refused } = onApply(plan, source);
      // Lines refused by the editor (it cannot happen on an empty draft, but never drop silently) are listed too.
      const notAdded = plan.lines.slice(added).slice(0, refused).map((l): SkippedLine => ({ name: l.kind === "catalog" ? l.medicine.name : l.name, reason: "over_limit" }));
      setSkipped([...plan.skipped, ...notAdded]);
    } catch (e) {
      setError(e instanceof ClientApiError ? e.message : "The last order could not be loaded. Nothing was added.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {skipped.length > 0 ? (
        <div data-testid="repeat-skipped">
          <Banner kind="warning">
            <p className="font-medium">
              {skipped.length} {lineWord(skipped.length)} from the last order {skipped.length === 1 ? "was" : "were"} left out:
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {skipped.map((s, i) => (
                <li key={`${s.name}:${i}`} dir="auto">
                  {s.name}: {REASON_TEXT[s.reason]}
                </li>
              ))}
            </ul>
            <p className="mt-1">You can still add them by hand.</p>
            <Button variant="secondary" className="mt-2" data-testid="repeat-skipped-dismiss" onClick={() => setSkipped([])}>
              Dismiss
            </Button>
          </Banner>
        </div>
      ) : null}

      {source && !hasLines ? (
        <div className="space-y-2">
          <Button className="w-full" variant="secondary" onClick={repeat} loading={busy} disabled={disabled} data-testid="repeat-last-order">
            <Repeat size={20} aria-hidden="true" />
            Repeat last order
          </Button>
          <p className="text-sm text-muted" data-testid="repeat-source">
            {formatOrderNumber(source.order_number)} · {source.line_count} {lineWord(source.line_count)} · {formatPakistanDateTime(source.confirmed_at)}
          </p>
          {error ? (
            <div role="alert" data-testid="repeat-error" className="space-y-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-danger">
              <p className="text-sm">{error}</p>
              <Button variant="secondary" onClick={repeat} data-testid="repeat-retry">
                Retry
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
