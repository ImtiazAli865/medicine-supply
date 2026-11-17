"use client";

import { Square } from "lucide-react";
import { Button } from "@/components/ui/Button";

/** Shown while the browser is listening: a plain state in words, the words as they arrive, and a large Stop button. */
export function ListeningBar({ interim, onStop }: { interim: string; onStop: () => void }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2 rounded-xl border border-primary/40 bg-primary-soft p-4" data-testid="voice-listening">
      <p className="font-semibold text-primary-strong">Listening… speak the order now.</p>
      {interim ? (
        <p className="break-words text-sm" dir="auto" data-testid="voice-interim">
          {interim}
        </p>
      ) : null}
      <Button onClick={onStop} data-testid="voice-stop" className="w-full">
        <Square size={20} aria-hidden="true" />
        Stop
      </Button>
    </div>
  );
}
