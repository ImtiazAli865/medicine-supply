"use client";

import { RefreshCw } from "lucide-react";
import { Banner } from "@/components/ui/States";
import { Button } from "@/components/ui/Button";
import { formatPakistanDateTime } from "@/lib/orders/dates";
import { useOffline } from "./OfflineProvider";

/**
 * What the device copy of the lists is and how old it is (Module 009): the time of the last refresh, a note when it is older
 * than a day, the first-use note when nothing was ever loaded, a warning when the phone's storage is nearly full, and where the
 * order lives (this phone only). Says nothing when everything is fresh and the screen is online, so online screens stay as they were.
 */
export function DeviceNotes({ orderOnPhoneOnly = false }: { /** The order shown has not reached the server. */ orderOnPhoneOnly?: boolean }) {
  const { mode, online, cacheAge, storageLow, refreshing, refresh } = useOffline();
  if (mode === "starting") return null;

  if (mode === "unavailable" || mode === "newer_schema") {
    // Online use is unchanged; offline orders cannot be kept on this browser.
    return online ? null : (
      <div data-testid="device-note">
        <Banner kind="warning">Offline orders cannot be kept in this browser (for example in a private window). Nothing you change here is saved while offline.</Banner>
      </div>
    );
  }
  if (mode !== "ready") return null;

  const notes: Array<{ key: string; kind: "info" | "warning"; text: string }> = [];
  if (cacheAge?.empty) {
    notes.push({ key: "empty", kind: "warning", text: "The medicine and store lists are not loaded yet. Connect once and they are saved on this phone. You can still type a medicine or a store name." });
  } else if (cacheAge) {
    const at = cacheAge.medicinesUpdatedAt ? formatPakistanDateTime(cacheAge.medicinesUpdatedAt) : null;
    if (cacheAge.stale) notes.push({ key: "stale", kind: "warning", text: `The lists on this phone were updated ${at ?? "more than a day ago"}, which is more than a day ago. New or changed medicines may be missing until you are online.` });
    else if (!online && at) notes.push({ key: "age", kind: "info", text: `Medicine and store lists from this phone, updated ${at}.` });
  }
  if (storageLow) notes.push({ key: "storage", kind: "warning", text: "This phone's storage is nearly full, so the lists were not refreshed. Free some space to keep working offline." });
  if (orderOnPhoneOnly) notes.push({ key: "phone", kind: "info", text: "This order is on this phone only. Other devices will not see it until it has been sent." });

  if (notes.length === 0) return null;
  return (
    <div data-testid="device-note" className="space-y-2">
      {notes.map((n) => (
        <div key={n.key} data-testid={n.key === "storage" ? "device-copy-warning" : undefined}>
          <Banner kind={n.kind}>{n.text}</Banner>
        </div>
      ))}
      {online ? (
        <Button variant="secondary" onClick={() => void refresh()} loading={refreshing} data-testid="refresh-device-copy">
          <RefreshCw size={18} aria-hidden="true" />
          Refresh
        </Button>
      ) : null}
    </div>
  );
}
