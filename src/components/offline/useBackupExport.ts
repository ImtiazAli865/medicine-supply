"use client";

import { useCallback, useState } from "react";
import { fetchJson } from "@/lib/api/client";
import { backupFileName, serializeBackup } from "@/lib/backup/file";
import { buildBackupFile } from "@/lib/backup/client";
import type { ExportPage } from "@/lib/backup/export-repository";
import { useOffline } from "./OfflineProvider";

/** Saves a text as a file on the phone (the browser's download). */
export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface ExportDone {
  name: string;
  counts: { stores: number; orders: number; lines: number; waitingOrders: number; waitingStores: number };
  source: "server+device" | "device-only";
}

/** The one export used by Settings, by the sign-out warning and by "Clear device data". */
export function useBackupExport() {
  const { runtime } = useOffline();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ExportDone | null>(null);

  const exportNow = useCallback(async (): Promise<ExportDone | null> => {
    const db = runtime?.db;
    const identity = runtime?.identity;
    if (!db || !identity || identity.status !== "ok") {
      setError("The backup needs the phone's storage, which is not available here.");
      return null;
    }
    setBusy(true);
    setError(null);
    try {
      const file = await buildBackupFile({
        db,
        businessId: identity.businessId,
        now: () => new Date().toISOString(),
        // The connection flag is only a hint: the server is tried, and the file is made from this phone alone if it cannot be reached.
        fetchPage: async (cursor) => (await fetchJson<ExportPage>(`/api/backup/export?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)).data,
      });
      downloadText(backupFileName(file.exportedAt), serializeBackup(file));
      const result: ExportDone = { name: backupFileName(file.exportedAt), counts: file.counts, source: file.source };
      setDone(result);
      return result;
    } catch {
      setError("The backup could not be made. Nothing was changed.");
      return null;
    } finally {
      setBusy(false);
    }
  }, [runtime]);

  return { exportNow, busy, error, done };
}
