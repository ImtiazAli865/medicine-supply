"use client";

import { Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { LoadingBlock } from "@/components/ui/Spinner";
import { Banner } from "@/components/ui/States";
import { formatPakistanDateTime } from "@/lib/orders/dates";
import { BackupSection } from "./BackupSection";
import { DeviceOrderCard } from "./DeviceOrderCard";
import { DeviceStoreCard } from "./DeviceStoreCard";
import { ExportOffer } from "./ExportOffer";
import { useOffline } from "./OfflineProvider";

/**
 * Where the supplier checks that every order made in the field arrived (Module 009, US6): online or offline, the last successful
 * send, the counts, each waiting item with its reason and Retry, how old the lists on the phone are, the pause control, the
 * backup and "Clear device data". It says nothing more than what is true.
 */
export function SyncStatusSection() {
  const { mode, message, online, status, cacheAge, refresh, refreshing, runtime, storageLow } = useOffline();
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  if (mode === "starting") return <LoadingBlock label="Checking this phone…" />;
  if (mode === "unavailable" || mode === "newer_schema") {
    return (
      <section aria-label="Sync and backup" data-testid="sync-status" className="space-y-3">
        <h2 className="text-lg font-semibold">Sync and backup</h2>
        <Banner kind="warning">{message ?? "This browser cannot keep offline data here. The app works only while online."}</Banner>
      </section>
    );
  }
  if (mode !== "ready" || !status) return null;

  const { counts } = status;
  const unsent = counts.waiting + counts.blocked + counts.failed + counts.conflict + counts.syncing;

  async function clearNow() {
    if (!runtime) return;
    setClearing(true);
    setClearError(null);
    try {
      await runtime.clearData();
      window.location.reload();
    } catch (e) {
      setClearError(e instanceof Error ? e.message : "The data of this phone could not be deleted.");
      setClearing(false);
    }
  }

  return (
    <section aria-label="Sync and backup" data-testid="sync-status" className="space-y-4">
      <h2 className="text-xl font-semibold">Sync and backup</h2>

      <div className="space-y-1 rounded-xl border border-border bg-surface p-3">
        <p data-testid="sync-online" className="font-medium">
          {online ? "Online" : "Offline"}
          {status.paused ? " · sending is paused" : ""}
        </p>
        <p data-testid="sync-last" className="text-sm text-muted">
          {status.lastSyncAt ? `Last successful send: ${formatPakistanDateTime(status.lastSyncAt)}` : "Nothing has been sent from this phone yet."}
        </p>
        <p data-testid="sync-counts" className="text-sm">
          {counts.waiting + counts.blocked} waiting · {counts.syncing} sending · {counts.failed} failed · {counts.conflict} need a decision
        </p>
        <p data-testid="sync-cache" className="text-sm text-muted">
          {cacheAge && !cacheAge.empty
            ? `Medicine list updated ${cacheAge.medicinesUpdatedAt ? formatPakistanDateTime(cacheAge.medicinesUpdatedAt) : "—"}${cacheAge.stale ? " (more than a day ago)" : ""}; store list updated ${cacheAge.storesUpdatedAt ? formatPakistanDateTime(cacheAge.storesUpdatedAt) : "—"}.`
            : "The medicine and store lists are not saved on this phone yet. Connect once."}
        </p>
        {storageLow ? <Banner kind="warning">This phone&apos;s storage is nearly full, so the lists were not refreshed.</Banner> : null}
        <p className="text-xs text-muted">Orders are sent only while this app is open. What is kept here is on this phone only: other devices do not see it until it has been sent.</p>
        <div className="flex flex-wrap gap-2 pt-1">
          {online ? (
            <Button variant="secondary" onClick={() => void refresh()} loading={refreshing} data-testid="refresh-device-copy">
              <RefreshCw size={18} aria-hidden="true" />
              Refresh the device copy
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => void (status.paused ? runtime?.center?.resume() : runtime?.center?.pause())} data-testid="pause-sync">
            {status.paused ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
            {status.paused ? "Resume sending" : "Pause sending"}
          </Button>
        </div>
        {status.paused ? <p className="text-sm text-warning">Sending is paused. Every order stays on this phone until you resume.</p> : null}
      </div>

      {status.items.length === 0 ? (
        <p data-testid="sync-empty" className="rounded-xl border border-dashed border-border bg-surface px-4 py-5 text-center text-muted">
          {status.lastSyncAt ? `Everything is sent as of ${formatPakistanDateTime(status.lastSyncAt)}.` : "Nothing is waiting on this phone."}
        </p>
      ) : (
        <ul className="space-y-3" data-testid="sync-items">
          {status.items.map((item) => (item.kind === "store" ? <DeviceStoreCard key={`store-${item.storeId}`} item={item} /> : <DeviceOrderCard key={item.orderId} item={item} />))}
        </ul>
      )}

      <BackupSection />

      <div className="space-y-2">
        <Button variant="danger" onClick={() => setClearOpen(true)} data-testid="clear-device-data">
          <Trash2 size={18} aria-hidden="true" />
          Clear device data
        </Button>
        <p className="text-sm text-muted">Deletes the lists and orders kept on this phone for this business. Orders that are on the server are not touched.</p>
      </div>

      <Dialog open={clearOpen} title="Clear the data of this phone?" onClose={() => (clearing ? undefined : setClearOpen(false))}>
        <p>The medicine and store lists and every order kept on this phone for this business will be deleted from this phone.</p>
        <ExportOffer count={unsent} />
        {clearError ? <Banner kind="error">{clearError}</Banner> : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" onClick={() => void clearNow()} loading={clearing} data-testid="clear-device-data-confirm">
            {unsent > 0 ? "Delete anyway" : "Delete the data of this phone"}
          </Button>
          <Button variant="secondary" onClick={() => setClearOpen(false)} disabled={clearing}>
            Keep it
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
