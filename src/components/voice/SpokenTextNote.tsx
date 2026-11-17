"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import type { Order } from "@/lib/orders/types";
import { claimSpokenText, clearSpokenText, readSpokenFor } from "@/lib/voice/session";

const subscribeNever = () => () => {};

/**
 * Read-only "Spoken text" of the order screen. For a voice order it is the words the order was made from (kept with the
 * order). For a manual order opened by "Take this order by hand" it is a dismissible "What you said" note taken from this
 * tab only: it is not a field of the order, is never saved, and is never shown on another order. It holds no price or
 * balance and never appears on an invoice or print.
 */
export function SpokenTextNote({ order, orderId }: { order: Order | null; orderId: string }) {
  const voiceText = order?.source === "voice" ? (order.spoken_text ?? null) : null;
  const isManual = order === null || order.source === "manual";
  const waiting = useSyncExternalStore(subscribeNever, () => (isManual ? readSpokenFor(orderId) : null), () => null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isManual) claimSpokenText(orderId);
  }, [isManual, orderId]);

  if (voiceText) {
    return (
      <section aria-label="Spoken text" className="space-y-1 rounded-xl border border-border bg-surface p-4" data-testid="spoken-text">
        <p className="text-sm font-medium text-muted">Spoken text (read only)</p>
        <p className="whitespace-pre-wrap break-words" dir="auto" data-testid="spoken-text-body">
          {voiceText}
        </p>
      </section>
    );
  }

  if (waiting && !dismissed) {
    return (
      <section aria-label="What you said" className="space-y-2 rounded-xl border border-border bg-surface p-4" data-testid="what-you-said">
        <p className="text-sm font-medium text-muted">What you said (this tab only, not part of the order)</p>
        <p className="whitespace-pre-wrap break-words" dir="auto" data-testid="what-you-said-body">
          {waiting}
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            clearSpokenText();
            setDismissed(true);
          }}
          data-testid="what-you-said-dismiss"
        >
          Hide this
        </Button>
      </section>
    );
  }
  return null;
}
