"use client";

import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/States";

/**
 * A voice or AI failure in plain words. The transcript is always kept, and there is always a way forward that needs no
 * AI: Retry, the simple reader, or taking the order by hand. Nothing here ever blocks taking an order.
 */
export function VoiceFailure({
  message,
  onRetry,
  onSimpleReader,
  onByHand,
  busy,
}: {
  message: string;
  onRetry: () => void;
  onSimpleReader: () => void;
  onByHand: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-3" data-testid="voice-failure">
      <Banner kind="error">{message}</Banner>
      <p className="text-sm text-muted">What you said is kept in the box above.</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onRetry} loading={busy} data-testid="voice-retry">
          Retry
        </Button>
        <Button variant="secondary" onClick={onSimpleReader} disabled={busy} data-testid="voice-simple-reader">
          Use the simple reader
        </Button>
        <Button variant="secondary" onClick={onByHand} disabled={busy} data-testid="voice-by-hand">
          Take this order by hand
        </Button>
      </div>
    </div>
  );
}
