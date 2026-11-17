"use client";

import { useState } from "react";
import { KeepCorrectionsDialog } from "@/components/voice/KeepCorrectionsDialog";
import { VoiceLineRow } from "@/components/voice/VoiceLineRow";
import { VoiceStoreBlock } from "@/components/voice/VoiceStoreBlock";
import { MedicineSearch } from "@/components/orders/MedicineSearch";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea } from "@/components/ui/Field";
import { Banner } from "@/components/ui/States";
import { candidateFromMedicine } from "@/lib/voice/candidate";
import { canCreate, hasCorrections, type PreviewAction, type PreviewState } from "@/lib/voice/preview-state";
import { VOICE_LIMITS, type ParserKind } from "@/lib/voice/types";

/** What reading the text again came to: an error to show, or a note to show after a success. */
export interface ReadAgainOutcome {
  error: string | null;
  notice: string | null;
}

/**
 * The order preview: the transcript beside the parsed store and lines, every doubt written out, every correction
 * allowed. Nothing exists until the supplier taps "Create draft order", which makes a normal DRAFT order (it is never
 * confirmed, priced or invoiced here). The button says why it is disabled. The supplier can also add a medicine, change
 * the text and read it again (keeping or discarding their corrections), or start over.
 */
export function VoicePreview({
  state,
  transcript,
  dispatch,
  creating,
  reading,
  createError,
  onCreate,
  onReadAgain,
  onStartOver,
  onByHand,
}: {
  state: PreviewState;
  transcript: string;
  dispatch: (action: PreviewAction) => void;
  creating: boolean;
  /** The parser that is reading the text again right now, or null. */
  reading: ParserKind | null;
  createError: string | null;
  onCreate: () => void;
  onReadAgain: (text: string, parser: ParserKind, keepCorrections: boolean) => Promise<ReadAgainOutcome>;
  onStartOver: () => void;
  onByHand: () => void;
}) {
  const [confirmingStartOver, setConfirmingStartOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(transcript);
  const [asking, setAsking] = useState<{ text: string; parser: ParserKind } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ready = canCreate(state);
  const full = state.lines.length >= VOICE_LIMITS.lines;
  const busy = creating || reading !== null;
  const draftTooLong = draft.length > VOICE_LIMITS.transcript;

  function openEditor() {
    setDraft(transcript);
    setReadError(null);
    setNotice(null);
    setEditing(true);
  }

  async function readAgain(text: string, parser: ParserKind, keep: boolean) {
    setAsking(null);
    setReadError(null);
    setNotice(null);
    const outcome = await onReadAgain(text, parser, keep);
    if (outcome.error) {
      setReadError(outcome.error);
      return;
    }
    setNotice(outcome.notice);
    setEditing(false);
  }

  function requestReadAgain(parser: ParserKind) {
    const text = draft.trim();
    if (text === "") {
      setReadError("Say or type the order first.");
      return;
    }
    if (hasCorrections(state)) setAsking({ text, parser });
    else void readAgain(text, parser, false);
  }

  return (
    <section aria-labelledby="voice-preview-heading" className="space-y-4" data-testid="voice-preview">
      <h2 id="voice-preview-heading" className="text-xl font-semibold">
        Check the order
      </h2>
      <p className="text-sm text-muted">
        This is what the app understood. Check every line against what you said. Nothing is saved until you tap Create draft order.
        {state.parser === "rules" ? " It was read by the simple reader." : ""}
      </p>

      <div className="space-y-2 rounded-xl border border-border bg-surface p-4" data-testid="voice-transcript-card">
        <p className="text-sm text-muted">What you said</p>
        {editing ? (
          <div className="space-y-2">
            <TextArea
              id="voice-edit-transcript"
              label="Order text"
              rows={4}
              dir="auto"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              error={draftTooLong ? `Use at most ${VOICE_LIMITS.transcript.toLocaleString("en-US")} characters.` : undefined}
              data-testid="voice-edit-transcript"
            />
            {readError ? <Banner kind="error">{readError}</Banner> : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => requestReadAgain("ai")} loading={reading === "ai"} disabled={busy || draftTooLong} data-testid="voice-read-again">
                Read it again
              </Button>
              <Button variant="secondary" onClick={() => requestReadAgain("rules")} loading={reading === "rules"} disabled={busy || draftTooLong} data-testid="voice-read-again-rules">
                Use the simple reader
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy} data-testid="voice-edit-cancel">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="break-words" dir="auto" data-testid="voice-transcript-readonly">
              {transcript}
            </p>
            <Button variant="secondary" onClick={openEditor} disabled={busy} data-testid="voice-edit-text">
              Change the text and read it again
            </Button>
          </>
        )}
      </div>

      {notice ? <Banner kind="warning"><span data-testid="voice-read-notice">{notice}</span></Banner> : null}

      {state.unreadable.length > 0 ? (
        <Banner kind="warning">
          <span data-testid="voice-unreadable">
            Could not read this part: {state.unreadable.map((part) => `"${part}"`).join(", ")}. Add it as a line below, or change the text and read it again.
          </span>
        </Banner>
      ) : null}

      <VoiceStoreBlock store={state.store} moreThanOne={state.moreThanOneStore} dispatch={dispatch} />

      <section aria-labelledby="voice-lines-heading" className="space-y-3">
        <h3 id="voice-lines-heading" className="text-lg font-semibold">
          Lines ({state.lines.length})
        </h3>
        {state.lines.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface p-4 text-muted" data-testid="voice-no-lines">
            No medicine was understood. Change the text and read it again, add a medicine below, or take this order by hand.
          </p>
        ) : (
          <ul className="space-y-3" data-testid="voice-lines">
            {state.lines.map((line) => (
              <VoiceLineRow key={line.lineId} line={line} dispatch={dispatch} />
            ))}
          </ul>
        )}
        <Button variant="secondary" className="w-full" onClick={() => setAdding(true)} disabled={busy || full} data-testid="voice-add-line">
          Add a medicine
        </Button>
        {full ? (
          <p role="status" className="text-sm text-warning" data-testid="voice-line-limit">
            An order can have at most {VOICE_LIMITS.lines} lines. Remove a line to add another, or create this order and start a new one.
          </p>
        ) : null}
      </section>

      {createError ? <Banner kind="error">{createError}</Banner> : null}

      <div className="space-y-2 rounded-xl border border-border bg-surface p-4">
        {!ready.ok ? (
          <p role="status" className="text-sm text-warning" data-testid="voice-create-reason">
            {ready.reason}
          </p>
        ) : (
          <p className="text-sm text-muted">Everything is checked. This makes a draft order; you confirm it later like any other order.</p>
        )}
        <Button className="w-full" onClick={onCreate} disabled={!ready.ok || reading !== null} loading={creating} data-testid="voice-create">
          Create draft order
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onByHand} disabled={busy} data-testid="voice-preview-by-hand">
            Take this order by hand
          </Button>
          <Button variant="ghost" onClick={() => setConfirmingStartOver(true)} disabled={busy} data-testid="voice-start-over">
            Start over
          </Button>
        </div>
      </div>

      <MedicineSearch
        open={adding}
        onClose={() => setAdding(false)}
        onPickProduct={(product) => {
          // Only the identity and description of the medicine are kept; no price field ever enters the preview.
          dispatch({ type: "add_catalog_line", product: candidateFromMedicine(product) });
          setAdding(false);
        }}
        onPickTyped={(name, quantity, unit) => {
          dispatch({ type: "add_typed_line", name, quantity, unit });
          setAdding(false);
        }}
      />

      <KeepCorrectionsDialog
        open={asking !== null}
        onKeep={() => asking && void readAgain(asking.text, asking.parser, true)}
        onDiscard={() => asking && void readAgain(asking.text, asking.parser, false)}
        onCancel={() => setAsking(null)}
      />

      <Dialog open={confirmingStartOver} title="Start over?" onClose={() => setConfirmingStartOver(false)}>
        <p>The transcript and this preview will be cleared. No order has been created.</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="danger"
            data-testid="voice-start-over-confirm"
            onClick={() => {
              setConfirmingStartOver(false);
              onStartOver();
            }}
          >
            Clear and start over
          </Button>
          <Button variant="secondary" onClick={() => setConfirmingStartOver(false)}>
            Keep working
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
