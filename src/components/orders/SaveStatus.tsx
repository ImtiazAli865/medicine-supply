"use client";

import { AlertTriangle, Check, HardDrive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { AutosaveStatus } from "@/lib/orders/autosave";
import { formatPakistanTime } from "@/lib/orders/dates";

/**
 * The honest save state of an order: Saving, Saved at HH:MM, Not saved (with Retry) or Changed elsewhere
 * (with Review). "Saved" is shown only after the server confirmed the change. "Saved on this device, not yet sent" (Module 009)
 * means the change is kept on this phone and the server has not confirmed it.
 */
export function SaveStatus({
  status,
  lastSavedAt,
  error,
  onRetry,
  onReview,
}: {
  status: AutosaveStatus;
  lastSavedAt: string | null;
  error: string | null;
  onRetry: () => void;
  onReview: () => void;
}) {
  if (status === "not_saved") {
    return (
      <div role="alert" data-testid="save-status" data-state="not_saved" className="flex flex-wrap items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-danger">
        <AlertTriangle size={20} aria-hidden="true" />
        <span className="font-medium">Not saved</span>
        {error ? <span className="text-sm">{error}</span> : null}
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  if (status === "changed_elsewhere") {
    return (
      <div role="alert" data-testid="save-status" data-state="changed_elsewhere" className="flex flex-wrap items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-warning">
        <AlertTriangle size={20} aria-hidden="true" />
        <span className="font-medium">Changed elsewhere</span>
        <span className="text-sm">This order was changed in another tab or device. Your changes are not saved.</span>
        <Button variant="secondary" onClick={onReview}>
          Review the current order
        </Button>
      </div>
    );
  }
  if (status === "on_device") {
    return (
      <div role="status" aria-live="polite" data-testid="save-status" data-state="on_device" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-warning-soft px-3 py-2 text-warning">
        <HardDrive size={18} aria-hidden="true" />
        <span className="font-medium">Saved on this device, not yet sent</span>
        <span className="text-sm">It is sent when the connection returns, while the app is open.</span>
        <Button variant="secondary" onClick={onRetry} data-testid="sync-retry">
          Send now
        </Button>
      </div>
    );
  }
  if (status === "pending" || status === "saving") {
    return (
      <p role="status" aria-live="polite" data-testid="save-status" data-state="saving" className="flex items-center gap-2 text-muted">
        <Loader2 size={18} className="animate-spin" aria-hidden="true" /> Saving…
      </p>
    );
  }
  if (lastSavedAt) {
    return (
      <p role="status" aria-live="polite" data-testid="save-status" data-state="saved" className="flex items-center gap-2 text-primary-strong">
        <Check size={18} aria-hidden="true" /> Saved at {formatPakistanTime(lastSavedAt)}
      </p>
    );
  }
  return (
    <p role="status" aria-live="polite" data-testid="save-status" data-state="idle" className="text-muted">
      Saving starts as soon as you add something.
    </p>
  );
}
