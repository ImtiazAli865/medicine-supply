"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { EditableLine, PreviewAction } from "@/lib/voice/preview-state";
import type { Candidate, LineFlag } from "@/lib/voice/types";

export const FLAG_TEXT: Record<LineFlag, string> = {
  missing_quantity: "The quantity was not heard. Enter it.",
  quantity_not_whole: "The quantity must be a whole number. Enter it.",
  quantity_too_small: "The quantity must be at least 1. Enter it.",
  quantity_too_large: "The quantity is too large (at most 100,000). Enter it.",
  unit_not_heard: "The unit was not heard. Check it.",
  duplicate_spoken: "Spoken twice: kept as two separate lines. Remove one if it is a mistake.",
};

const inputClass = "block min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base";

function details(candidate: Candidate): string {
  return [candidate.strength, candidate.dosage_form, candidate.manufacturer, candidate.pack_size].filter(Boolean).join(" · ");
}

function CandidateButton({ candidate, onPick }: { candidate: Candidate; onPick: (c: Candidate) => void }) {
  return (
    <li>
      <button
        type="button"
        data-testid="voice-candidate"
        onClick={() => onPick(candidate)}
        className="flex min-h-14 w-full flex-col items-start gap-0.5 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:border-primary"
      >
        <span className="font-semibold" dir="auto">
          {candidate.name}
        </span>
        {details(candidate) ? (
          <span className="text-sm text-muted" dir="auto">
            {details(candidate)}
          </span>
        ) : null}
        {candidate.unit ? <span className="text-sm text-muted">Unit: {candidate.unit}</span> : null}
      </button>
    </li>
  );
}

/**
 * One spoken medicine. State in words: Matched (one exact catalog medicine), Choose one (several or similar: nothing is
 * preselected), or Not in catalog (kept as typed, exactly as spoken, like a pending line). Quantity and unit are
 * editable; every doubt is written out. Every rule lives in preview-state.ts, not here.
 */
export function VoiceLineRow({ line, dispatch }: { line: EditableLine; dispatch: (action: PreviewAction) => void }) {
  const [qtyText, setQtyText] = useState(line.quantity === null ? "" : String(line.quantity));
  const [changing, setChanging] = useState(false);
  const chosen = line.choice?.kind === "catalog" ? line.choice : null;
  const chosenCandidate = chosen ? line.candidates.find((c) => c.id === chosen.productId) : undefined;
  const needsChoice = line.choice === null;
  const showCandidates = (needsChoice || changing) && line.candidates.length > 0;

  const badge =
    line.choice?.kind === "typed" ? { text: "Not in catalog (typed)", tone: "warning" as const } : chosen ? { text: line.state === "matched" ? "Matched" : "Chosen", tone: "success" as const } : { text: "Choose one", tone: "warning" as const };

  return (
    <li className="space-y-3 rounded-xl border border-border bg-surface p-4" data-testid="voice-line" data-line-state={line.state} data-choice={line.choice?.kind ?? "none"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-muted">You said</p>
          <p className="break-words font-semibold" dir="auto" data-testid="voice-line-spoken">
            {line.spoken}
          </p>
        </div>
        <Badge tone={badge.tone}>{badge.text}</Badge>
      </div>

      {chosen ? (
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm" data-testid="voice-line-chosen">
          <span className="font-medium" dir="auto">
            {chosen.name}
          </span>
          {chosenCandidate && details(chosenCandidate) ? <span className="block text-muted">{details(chosenCandidate)}</span> : null}
          {line.candidates.length > 1 ? (
            <button type="button" className="mt-1 inline-flex min-h-11 items-center text-primary underline" onClick={() => setChanging((v) => !v)} data-testid="voice-line-change">
              {changing ? "Keep this medicine" : "Choose a different one"}
            </button>
          ) : null}
        </div>
      ) : null}

      {line.choice?.kind === "typed" ? (
        <p className="text-sm text-muted" data-testid="voice-line-typed">
          Not in the catalog: it will be kept exactly as you said it, shown as Not registered with no selling price. You can register it later.
          {line.candidates.length > 0 ? (
            <button type="button" className="ml-2 inline-flex min-h-11 items-center text-primary underline" onClick={() => setChanging(true)}>
              Look at the similar medicines again
            </button>
          ) : null}
        </p>
      ) : null}

      {showCandidates ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">{needsChoice ? "Which medicine did you mean? Nothing is chosen for you." : "Choose a medicine"}</p>
          <ul className="space-y-2">
            {line.candidates.map((candidate) => (
              <CandidateButton
                key={candidate.id}
                candidate={candidate}
                onPick={(c) => {
                  dispatch({ type: "choose_candidate", key: line.key, candidate: c });
                  setChanging(false);
                }}
              />
            ))}
          </ul>
          <Button
            variant="secondary"
            className="w-full"
            data-testid="voice-none-of-these"
            onClick={() => {
              dispatch({ type: "choose_typed", key: line.key });
              setChanging(false);
            }}
          >
            None of these, it is a new medicine
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor={`qty-${line.key}`} className="block text-sm font-medium">
            Quantity
          </label>
          <input
            id={`qty-${line.key}`}
            data-testid="voice-quantity"
            inputMode="numeric"
            autoComplete="off"
            className={`${inputClass} ${line.quantity === null ? "border-danger" : ""}`}
            value={qtyText}
            onChange={(event) => {
              const text = event.target.value;
              setQtyText(text);
              dispatch({ type: "set_quantity", key: line.key, quantity: text.trim() === "" ? null : Number(text) });
            }}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`unit-${line.key}`} className="block text-sm font-medium">
            Unit
          </label>
          <input
            id={`unit-${line.key}`}
            data-testid="voice-unit"
            autoComplete="off"
            maxLength={50}
            className={`${inputClass} ${!line.unit ? "border-danger" : ""}`}
            value={line.unit ?? ""}
            onChange={(event) => dispatch({ type: "set_unit", key: line.key, unit: event.target.value })}
          />
        </div>
      </div>

      {line.flags.length > 0 ? (
        <ul className="space-y-1" data-testid="voice-line-flags">
          {line.flags.map((flag) => (
            <li key={flag} className="text-sm text-warning" data-flag={flag}>
              {FLAG_TEXT[flag]}
            </li>
          ))}
        </ul>
      ) : null}

      <Button variant="ghost" onClick={() => dispatch({ type: "remove_line", key: line.key })} data-testid="voice-remove-line">
        Remove this line
      </Button>
    </li>
  );
}
