"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/States";
import { paymentsInFile, useBackupExport } from "./useBackupExport";

/**
 * The one warning shown before orders could be lost (Module 009, FR-031): "Unsynced orders will be lost" with an
 * "Export backup" button that uses the same export as the Settings screen. Used by the sign-out warning and by
 * "Clear device data".
 */
export function ExportOffer({ count }: { count: number }) {
  const { exportNow, busy, error, done } = useBackupExport();
  if (count <= 0) return null;
  return (
    <div className="space-y-2" data-testid="export-offer">
      <Banner kind="warning">
        {count} {count === 1 ? "item is" : "items are"} not on the server yet. If the data of this phone is cleared, {count === 1 ? "it" : "they"} will be lost. Save a backup file first.
      </Banner>
      <Button variant="secondary" onClick={() => void exportNow()} loading={busy} data-testid="export-offer-button">
        <Download size={18} aria-hidden="true" />
        Export backup
      </Button>
      {done ? (
        <p role="status" className="text-sm text-primary-strong" data-testid="export-offer-done">
          Saved {done.name}: {done.counts.waitingOrders} waiting {done.counts.waitingOrders === 1 ? "order" : "orders"}, {done.counts.orders} {done.counts.orders === 1 ? "order" : "orders"} from the server. {paymentsInFile(done)}
        </p>
      ) : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
    </div>
  );
}
