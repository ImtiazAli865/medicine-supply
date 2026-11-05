"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Banner, ErrorState } from "@/components/ui/States";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import { newId } from "@/lib/ids";
import { readImportFile } from "@/lib/import/read-file";
import { ImportFileError, type ApplyResponse, type ImportSummary, type PreviewResponse, type RawRow, type ReadResult } from "@/lib/import/types";
import { ConfirmPanel, planOf } from "./ConfirmPanel";
import { FilePicker } from "./FilePicker";
import { PreviewFilters, type PreviewFilter } from "./PreviewFilters";
import { PreviewList } from "./PreviewList";
import { TemplateButtons } from "./TemplateButtons";

// Pending confirm: kept only for the lifetime of the tab, so a refresh in the middle of a confirm can
// look up whether that import was applied instead of asking again. The file itself is never kept.
const PENDING_KEY = "import:pending";

type Stage = "choose" | "reading" | "previewing" | "preview" | "confirming";

interface Loaded {
  fileName: string;
  result: ReadResult;
}

function errorMessage(e: unknown): string {
  if (e instanceof ClientApiError) return e.message;
  return "Something went wrong. Please try again.";
}

export function ImportWizard() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("choose");
  const [fileError, setFileError] = useState<ImportFileError | string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<PreviewFilter>("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const approval = useRef<{ key: string; id: string } | null>(null);

  // A refresh during a confirm: if that import was applied, show its summary.
  useEffect(() => {
    const pending = sessionStorage.getItem(PENDING_KEY);
    if (!pending) return;
    fetchJson<ImportSummary>(`/api/imports/${pending}`)
      .then(() => {
        sessionStorage.removeItem(PENDING_KEY);
        router.replace(`/products/import?import=${pending}`);
      })
      .catch(() => sessionStorage.removeItem(PENDING_KEY));
  }, [router]);

  const rawByRow = useMemo(() => new Map<number, RawRow>((loaded?.result.rows ?? []).map((r) => [r.row_no, r])), [loaded]);

  const rowsToShow = useMemo(
    () => (preview ? (filter === "all" ? preview.rows : preview.rows.filter((r) => r.status === filter)) : []),
    [preview, filter],
  );

  const similarRows = useMemo(() => new Set((preview?.rows ?? []).filter((r) => r.status === "similar").map((r) => r.row_no)), [preview]);
  const chosenSimilar = useMemo(() => [...chosen].filter((n) => similarRows.has(n)).sort((a, b) => a - b), [chosen, similarRows]);

  async function runPreview(rows: RawRow[]): Promise<boolean> {
    setStage("previewing");
    setPreviewError(null);
    try {
      const { data } = await fetchJson<PreviewResponse>("/api/imports/preview", { json: { rows } });
      setPreview(data);
      setStage("preview");
      return true;
    } catch (e) {
      setPreviewError(errorMessage(e));
      setStage("preview");
      return false;
    }
  }

  async function onFile(file: File) {
    setFileError(null);
    setNotice(null);
    setConfirmError(null);
    setPreview(null);
    setChosen(new Set());
    setFilter("all");
    approval.current = null;
    setStage("reading");
    // Let the "Reading…" state paint before the (synchronous) parsing starts.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const result = await readImportFile(file);
      setLoaded({ fileName: file.name, result });
      await runPreview(result.rows);
    } catch (e) {
      setLoaded(null);
      setFileError(e instanceof ImportFileError ? e : "This file could not be read. Please try another file.");
      setStage("choose");
    }
  }

  function reset() {
    setStage("choose");
    setLoaded(null);
    setPreview(null);
    setPreviewError(null);
    setChosen(new Set());
    setNotice(null);
    setConfirmError(null);
    approval.current = null;
  }

  function toggle(rowNo: number) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(rowNo)) next.delete(rowNo);
      else next.add(rowNo);
      return next;
    });
  }

  function setAllSimilar(on: boolean) {
    setChosen(on ? new Set(similarRows) : new Set());
  }

  async function confirm() {
    if (!preview || !loaded || stage === "confirming") return;
    // One id per approved preview + choices: a retry of the same approval repeats the same id, so the
    // server returns the original result instead of importing twice.
    const key = `${preview.fingerprint}|${chosenSimilar.join(",")}`;
    let id: string;
    try {
      if (approval.current?.key !== key) approval.current = { key, id: newId() };
      id = approval.current.id;
    } catch {
      // Never fail silently: tell the user nothing was sent.
      setConfirmError("This browser could not prepare the import, so nothing was sent or saved. Please try again or use another browser.");
      return;
    }
    try {
      sessionStorage.setItem(PENDING_KEY, id);
    } catch {
      // Private browsing may block storage; the import itself does not depend on it.
    }
    setConfirmError(null);
    setStage("confirming");
    try {
      await fetchJson<ApplyResponse>("/api/imports", {
        json: {
          import_id: id,
          file_name: loaded.fileName,
          file_kind: loaded.result.fileKind,
          rows: loaded.result.rows,
          fingerprint: preview.fingerprint,
          create_similar: chosenSimilar,
        },
      });
      sessionStorage.removeItem(PENDING_KEY);
      router.push(`/products/import?import=${id}`);
    } catch (e) {
      if (e instanceof ClientApiError && e.code === "import_changed") {
        // The catalog changed after the preview: nothing was imported. Show a fresh preview.
        sessionStorage.removeItem(PENDING_KEY);
        approval.current = null;
        setNotice("Your medicine list changed after this preview, so nothing was imported. Please review the new preview below.");
        const ok = await runPreview(loaded.result.rows);
        if (ok) setChosen(new Set()); // choices from the old preview no longer apply
        return;
      }
      // Network or server error: nothing is reported as saved. Pressing Confirm again is safe.
      setConfirmError(
        e instanceof ClientApiError && e.code === "network"
          ? "Could not reach the server, so we cannot tell if the import finished. Press Confirm import again: it will never create duplicates."
          : errorMessage(e),
      );
      setStage("preview");
    }
  }

  const busy = stage === "reading" || stage === "previewing" || stage === "confirming";

  return (
    <div className="space-y-5">
      <section aria-labelledby="template-title" className="space-y-2">
        <h2 id="template-title" className="text-lg font-semibold">1. Get the template (optional)</h2>
        <TemplateButtons />
      </section>

      <section aria-labelledby="file-title" className="space-y-3">
        <h2 id="file-title" className="text-lg font-semibold">2. Choose your file</h2>
        <FilePicker disabled={busy} onFile={(f) => void onFile(f)} />

        {fileError ? (
          <div data-testid="file-error">
            <Banner kind="error">
              <p>{typeof fileError === "string" ? fileError : fileError.message}</p>
              {typeof fileError !== "string" && fileError.found && fileError.expected ? (
                <p className="mt-2 break-words">
                  <strong>Found:</strong> {fileError.found.join(", ") || "(none)"}.<br />
                  <strong>Expected:</strong> {fileError.expected.join(", ")}.
                </p>
              ) : null}
            </Banner>
          </div>
        ) : null}

        {stage === "reading" ? (
          <div className="flex items-center gap-2" role="status" data-testid="reading">
            <Spinner label="" />
            <span>Reading your file…</span>
          </div>
        ) : null}
        {stage === "previewing" ? (
          <div className="flex items-center gap-2" role="status" data-testid="previewing">
            <Spinner label="" />
            <span>Checking {loaded?.result.rows.length.toLocaleString("en-US")} rows against your medicine list…</span>
          </div>
        ) : null}
      </section>

      {loaded && (stage === "preview" || stage === "confirming") ? (
        <section aria-labelledby="preview-title" className="space-y-3">
          <h2 id="preview-title" className="text-lg font-semibold">3. Review before anything is saved</h2>
          <p className="text-sm text-muted" dir="auto">
            {loaded.fileName}
            {loaded.result.sheetName ? ` · sheet "${loaded.result.sheetName}" was read` : ""}
          </p>
          {loaded.result.exampleIgnored ? <Banner>The template&apos;s example row was ignored.</Banner> : null}
          {notice ? <div data-testid="changed-notice"><Banner kind="warning">{notice}</Banner></div> : null}

          {previewError || !preview ? (
            <ErrorState message={previewError ?? "The preview could not be loaded."} onRetry={() => void runPreview(loaded.result.rows)} />
          ) : (
            <>
              <PreviewFilters counts={preview.counts} total={preview.total} value={filter} onChange={setFilter} />
              {similarRows.size > 0 ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setAllSimilar(true)} data-testid="create-all-similar">
                    Create all similar as separate
                  </Button>
                  <Button variant="secondary" onClick={() => setAllSimilar(false)}>
                    Skip all similar
                  </Button>
                </div>
              ) : null}
              <PreviewList key={filter} rows={rowsToShow} raw={rawByRow} chosen={chosen} onToggle={toggle} />

              {confirmError ? <div data-testid="confirm-error"><Banner kind="error">{confirmError}</Banner></div> : null}
              <ConfirmPanel
                plan={planOf(preview.counts, chosenSimilar.length)}
                busy={stage === "confirming"}
                onConfirm={() => void confirm()}
                onCancel={reset}
              />
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
