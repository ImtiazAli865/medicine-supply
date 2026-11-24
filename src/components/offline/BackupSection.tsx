"use client";

import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/States";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import { applyImport } from "@/lib/backup/apply";
import { loadDeviceSnapshot, loadServerSnapshot, readBackupText } from "@/lib/backup/client";
import type { ExportPage } from "@/lib/backup/export-repository";
import type { BackupFile } from "@/lib/backup/file";
import { previewImport, type ImportPreview as Preview } from "@/lib/backup/preview";
import { ImportPreview } from "./ImportPreview";
import { useOffline } from "./OfflineProvider";
import { useBackupExport } from "./useBackupExport";

/**
 * Export and import of the supplier's own order data and the orders waiting on the phone (Module 009, US5). The file holds no
 * price, invoice, payment, ledger entry or secret. Import shows a preview first and changes nothing until it is confirmed.
 */
export function BackupSection() {
  const { runtime, center } = useOffline();
  const { exportNow, busy: exporting, error: exportError, done } = useBackupExport();
  const input = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<{ file: BackupFile; name: string; preview: Preview } | null>(null);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  // The file that could not be checked against the server, kept so Retry can check it again without choosing it again.
  const [retryFile, setRetryFile] = useState<File | null>(null);

  const db = runtime?.db ?? null;
  const identity = runtime?.identity;
  const ready = db !== null && identity?.status === "ok";

  async function choose(files: FileList | null, again?: File) {
    const chosen = again ?? files?.[0];
    if (!chosen || !db || identity?.status !== "ok") return;
    setRetryFile(null);
    setError(null);
    setResult(null);
    setStaged(null);
    setLoading(true);
    try {
      const parsed = readBackupText(await chosen.text(), identity.businessId);
      if (!parsed.ok) {
        setError(parsed.message);
        return;
      }
      const server = await loadServerSnapshot(async (cursor) => (await fetchJson<ExportPage>(`/api/backup/export?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)).data);
      const device = await loadDeviceSnapshot(db);
      setStaged({ file: parsed.file, name: chosen.name, preview: previewImport(parsed.file, server, device) });
    } catch (e) {
      setRetryFile(chosen);
      setError(
        e instanceof ClientApiError && e.code === "network"
          ? "Importing needs the internet, so the file can be compared with what the server holds. Nothing was imported."
          : "The file could not be checked against the server. Try again. Nothing was imported.",
      );
    } finally {
      setLoading(false);
      if (input.current) input.current.value = "";
    }
  }

  async function confirmImport() {
    if (!staged || !db) return;
    setApplying(true);
    setError(null);
    try {
      const outcome = await applyImport(staged.preview.plan, db, () => new Date().toISOString());
      await center?.adoptJournal();
      if (outcome.failed.length > 0) setError(outcome.failed.join(" "));
      setResult(
        `Imported: ${outcome.ordersAdded} ${outcome.ordersAdded === 1 ? "order" : "orders"} and ${outcome.storesAdded} ${outcome.storesAdded === 1 ? "store" : "stores"} kept on this phone and sent by the normal queue. ${outcome.ordersSkipped + outcome.storesSkipped} already here.`,
      );
      setStaged(null);
    } finally {
      setApplying(false);
    }
  }

  return (
    <section aria-label="Backup" data-testid="backup-section" className="space-y-3">
      <h2 className="text-lg font-semibold">Backup</h2>
      <p className="text-sm text-muted">
        A backup file holds your orders and their lines, your stores, typed medicines and the orders still waiting on this phone. It never holds prices, invoices, payments, the ledger or any password.
      </p>
      {!ready ? (
        <Banner kind="warning">The backup needs the phone&apos;s storage, which is not available in this browser.</Banner>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void exportNow()} loading={exporting} data-testid="backup-export">
            <Download size={18} aria-hidden="true" />
            Export backup
          </Button>
          <Button variant="secondary" onClick={() => input.current?.click()} loading={loading} data-testid="backup-import">
            <Upload size={18} aria-hidden="true" />
            Import backup
          </Button>
          <input ref={input} type="file" accept="application/json,.json" className="sr-only" data-testid="backup-file" tabIndex={-1} aria-label="Backup file to import" onChange={(e) => void choose(e.target.files)} />
        </div>
      )}
      {done ? (
        <p role="status" data-testid="backup-export-done" className="text-sm text-primary-strong">
          Saved {done.name}: {done.counts.stores} stores, {done.counts.orders} orders, {done.counts.lines} lines, {done.counts.waitingOrders} waiting orders.
          {done.source === "device-only" ? " This file was made offline, so it holds only what this phone has." : ""}
        </p>
      ) : null}
      {exportError ? <Banner kind="error">{exportError}</Banner> : null}
      {error ? (
        <div data-testid="backup-error" className="space-y-2">
          <Banner kind="error">{error}</Banner>
          {retryFile ? (
            <Button variant="secondary" onClick={() => void choose(null, retryFile)} loading={loading} data-testid="backup-retry">
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
      {result ? (
        <div data-testid="import-result">
          <Banner kind="info">{result}</Banner>
        </div>
      ) : null}
      {staged ? <ImportPreview fileName={staged.name} exportedAt={staged.file.exportedAt} preview={staged.preview} busy={applying} onConfirm={() => void confirmImport()} onCancel={() => setStaged(null)} /> : null}
    </section>
  );
}
