"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

/** The one pending Undo of the order screen: the label and the ids of exactly the lines the last action added. */
export interface UndoAction {
  /** Changes with every action so a new action restarts the timer and replaces the old bar. */
  key: number;
  label: string;
  lineIds: string[];
}

export const UNDO_SECONDS = 8;

/** "Added [medicine]. Undo" for a few seconds. Undo removes only the lines of that one action. */
export function UndoBar({ action, onUndo, onDismiss }: { action: UndoAction | null; onUndo: (lineIds: string[]) => void; onDismiss: () => void }) {
  const key = action?.key;
  useEffect(() => {
    if (key === undefined) return;
    const timer = window.setTimeout(onDismiss, UNDO_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [key, onDismiss]);

  if (!action) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="undo-bar"
      className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary-soft px-3 py-1 text-primary-strong"
    >
      <p className="min-w-0 text-sm" dir="auto">
        {action.label}
      </p>
      <Button
        variant="ghost"
        data-testid="undo-action"
        onClick={() => {
          onUndo(action.lineIds);
          onDismiss();
        }}
      >
        Undo
      </Button>
    </div>
  );
}
