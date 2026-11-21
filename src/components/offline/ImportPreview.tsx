"use client";

import { Banner } from "@/components/ui/States";
import { Button } from "@/components/ui/Button";
import type { ImportPreview as Preview, Verdict } from "@/lib/backup/preview";

const HEADINGS: Record<Verdict, string> = {
  new: "Will be added to this phone",
  already_on_server: "Already on the server",
  already_on_device: "Already on this phone",
  conflict: "Different from the server or this phone (nothing is replaced)",
  cannot_restore: "Cannot be restored",
};

const ORDER: Verdict[] = ["new", "conflict", "cannot_restore", "already_on_server", "already_on_device"];

/** What the chosen file contains and what would happen, before anything is changed (Module 009, FR-029). */
export function ImportPreview({ fileName, exportedAt, preview, busy, onConfirm, onCancel }: { fileName: string; exportedAt: string; preview: Preview; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <section data-testid="import-preview" aria-label="Import preview" className="space-y-3 rounded-xl border border-border bg-surface p-3">
      <h3 className="text-base font-semibold">Import preview</h3>
      <p className="text-sm text-muted" dir="auto">
        {fileName} · made {exportedAt.slice(0, 10)}
      </p>
      <p className="text-sm" data-testid="import-preview-counts">
        {preview.counts.new} to add · {preview.counts.already_on_server + preview.counts.already_on_device} already here · {preview.counts.conflict} different · {preview.counts.cannot_restore} cannot be restored
      </p>
      {ORDER.map((verdict) => {
        const items = preview.items.filter((i) => i.verdict === verdict);
        if (items.length === 0) return null;
        return (
          <div key={verdict} data-testid={`import-group-${verdict}`}>
            <p className="font-medium">
              {HEADINGS[verdict]} ({items.length})
            </p>
            <ul className="mt-1 space-y-1 text-sm">
              {items.map((i) => (
                <li key={`${i.kind}-${i.id}`}>
                  <span className="font-medium" dir="auto">
                    {i.kind === "store" ? "Store: " : "Order: "}
                    {i.label}
                  </span>
                  <span className="block text-muted">{i.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {!preview.canApply ? <Banner kind="info">Nothing would change: everything in this file is already here.</Banner> : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={onConfirm} loading={busy} disabled={!preview.canApply} data-testid="import-confirm">
          Import
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
