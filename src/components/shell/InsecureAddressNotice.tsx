"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { useOffline } from "@/components/offline/OfflineProvider";
import { WORKER_NOTICE } from "@/lib/device/worker-status";

/**
 * Says so when the offline worker cannot start on this address, for example a phone that opens the app on a plain http address
 * of a computer (Module 011). It never blocks anything and is shown on every screen of the app until it is closed for this visit;
 * it is never shown on https or on localhost.
 */
export function InsecureAddressNotice() {
  const { worker } = useOffline();
  const [closed, setClosed] = useState(false);
  if (worker === "ok" || closed) return null;
  return (
    <div
      role="status"
      data-testid="insecure-address-notice"
      data-kind={worker}
      className="mb-3 flex items-start justify-between gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning print:hidden"
    >
      <p className="min-w-0 self-center">{WORKER_NOTICE[worker]}</p>
      <button
        type="button"
        onClick={() => setClosed(true)}
        aria-label="Close this notice"
        data-testid="insecure-address-close"
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg hover:bg-white/50"
      >
        <X size={20} aria-hidden="true" />
      </button>
    </div>
  );
}
