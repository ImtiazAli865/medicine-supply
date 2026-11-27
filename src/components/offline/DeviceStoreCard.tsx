"use client";

import { AlertTriangle, HardDrive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { SyncItem } from "@/lib/device/sync-center";
import { useOffline } from "./OfflineProvider";

const LABELS: Record<SyncItem["state"], string> = {
  waiting: "New store, not yet on the server",
  blocked: "New store, not yet on the server",
  syncing: "Creating the store…",
  failed: "The store could not be created",
  conflict: "Needs your decision",
  similar: "A similar store already exists",
};

/** A store made on this phone that the server has not created yet (Module 009, US4), with its own honest state. */
export function DeviceStoreCard({ item }: { item: SyncItem }) {
  const { center } = useOffline();
  const bad = item.state === "failed" || item.state === "similar";
  const Icon = item.state === "syncing" ? Loader2 : bad ? AlertTriangle : HardDrive;
  return (
    <li data-testid="device-store" data-state={item.state}>
      <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
        <p className="font-semibold" dir="auto">
          {item.name}
        </p>
        <p className={`flex flex-wrap items-center gap-2 text-sm font-medium ${bad ? "text-danger" : "text-warning"}`}>
          <Icon size={18} className={item.state === "syncing" ? "animate-spin" : undefined} aria-hidden="true" />
          {LABELS[item.state]}
        </p>
        <p className="text-sm text-muted">Other devices will not see this store until it has been created on the server.</p>
        {item.reason ? (
          <p className="text-sm text-muted" dir="auto" data-testid="store-failed-reason">
            {item.reason}
          </p>
        ) : null}
        {item.state === "similar" ? (
          <div data-testid="similar-store-question" className="space-y-2 rounded-lg bg-warning-soft p-3">
            <p className="font-medium">Is this the same store as one that is already on the server? Prices typed on its orders stay on them; nothing is remembered as the other store&apos;s price.</p>
            <ul className="space-y-2">
              {item.matches.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span dir="auto">{m.name}</span>
                  <Button variant="secondary" data-testid="use-existing-store" onClick={() => void center?.resolveSimilar(item.storeId, { choice: "use_existing", existingId: m.id })}>
                    Use the existing store
                  </Button>
                </li>
              ))}
            </ul>
            <Button variant="secondary" data-testid="create-store-anyway" onClick={() => void center?.resolveSimilar(item.storeId, { choice: "create_anyway" })}>
              Create a new store anyway
            </Button>
          </div>
        ) : null}
        {item.state === "failed" ? (
          <Button variant="secondary" onClick={() => center?.retry(item.storeId)} data-testid="sync-retry">
            Retry
          </Button>
        ) : null}
      </div>
    </li>
  );
}
